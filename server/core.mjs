import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isolatedCommand } from "./isolation.mjs";
export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const DATA = path.join(ROOT, ".frameshift");
export const id = () => crypto.randomUUID().slice(0, 12);
export async function json(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
}
export async function save(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + "." + process.pid + "." + id() + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(value, null, 2));
  await fs.rename(tmp, file);
}
export function within(root, name) {
  const p = path.resolve(root, name);
  if (p !== root && !p.startsWith(root + path.sep))
    throw Error("Path escapes workspace");
  return p;
}
export async function safeFile(root, name) {
  const p = within(root, name);
  const real = await fs.realpath(p);
  const realRoot = await fs.realpath(root);
  within(realRoot, path.relative(realRoot, real));
  return real;
}
export async function command(
  argv,
  cwd,
  { signal, onLog = () => {}, timeout = 120000, isolate = false } = {},
) {
  if (
    !Array.isArray(argv) ||
    !argv.length ||
    argv.some((x) => typeof x !== "string")
  )
    throw Error("Command must be an argument array");
  const isolation = isolate ? await isolatedCommand(argv, cwd) : null;
  const commandArgs = isolation?.argv || argv;
  return new Promise((resolve, reject) => {
    let output = "";
    let settled = false;
    const child = spawn(commandArgs[0], commandArgs.slice(1), {
      cwd,
      env: isolation?.env || {
        ...process.env,
        OPENAI_API_KEY: "",
        FRAMESHIFT_API_KEY: "",
        NODE_ENV: "production",
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    function kill() {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    }
    function done(err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      err ? reject(err) : resolve(output);
    }
    const abort = () => {
      kill();
      done(Error("Run stopped"));
    };
    const timer = setTimeout(() => {
      kill();
      done(Error("Command timed out"));
    }, timeout);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (b) => {
        const s = b.toString();
        output = (output + s).slice(-14000);
        onLog(s.slice(-1500));
      });
    child.on("error", (e) => done(e));
    child.on("close", (code,signalName) =>
      done(code === 0 ? null : Error("Build failed ("+(signalName||code)+"): " + output.slice(-3000))),
    );
  });
}
export async function copyProject(source, destination) {
  await fs.cp(source, destination, {
    recursive: true,
    filter: async (p) => {
      const rel = path.relative(source, p);
      if (!rel) return true;
      const parts = rel.split(path.sep);
      if (
        parts.some(
          (x) =>
            ["node_modules", ".git", ".frameshift", "dist", ".next"].includes(
              x,
            ) ||
            x.startsWith(".env") ||
            x.startsWith(".frameshift-"),
        )
      )
        return false;
      const stat = await fs.lstat(p);
      return !stat.isSymbolicLink();
    },
  });
}
export async function dependencies(workspace, original) {
  const dest = path.join(workspace, "node_modules");
  let modules = path.join(original, "node_modules");
  try {
    await fs.access(modules);
  } catch {
    modules = path.join(ROOT, "node_modules");
  }
  const stat = await fs.lstat(dest).catch(() => null);
  if (stat?.isSymbolicLink()) await fs.unlink(dest);
  await fs.mkdir(dest, { recursive: true });
  for (const name of await fs.readdir(modules)) {
    if ([".cache", ".vite", ".vite-temp"].includes(name)) continue;
    const target = path.join(dest, name);
    try {
      await fs.symlink(path.join(modules, name), target, "dir");
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
  }
}
export const quantile = (values, q) => {
  const a = [...values].sort((a, b) => a - b);
  return a[Math.min(a.length - 1, Math.floor(a.length * q))] ?? 0;
};
export function summarize(samples) {
  const frames = samples.flatMap((s) => s.frames),
    submit = samples.flatMap((s) => s.submit);
  return {
    frameMedian: quantile(frames, 0.5),
    frameP95: quantile(frames, 0.95),
    submitMedian: quantile(submit, 0.5),
    submitP95: quantile(submit, 0.95),
    fps: 1000 / quantile(frames, 0.5),
    calls: Math.round(
      quantile(
        samples.map((s) => s.calls),
        0.5,
      ),
    ),
    triangles: samples[0]?.triangles ?? 0,
    geometries: samples[0]?.geometries ?? 0,
    repeatMetrics: samples.map((s) => quantile(s.submit, 0.95)),
    samples: samples.length,
    frameCount: frames.length,
    renderer: samples[0]?.renderer,
    hardware: samples[0]?.hardware,
  };
}
export function compareState(reference, candidate) {
  if (reference.items.length !== candidate.items.length) return false;
  for (let i = 0; i < reference.items.length; i++) {
    const a = reference.items[i],
      b = candidate.items[i];
    if (a.length !== b.length || a[0] !== b[0]) return false;
    for (let j = 1; j < a.length; j++)
      if (!Number.isFinite(b[j]) || Math.abs(a[j] - b[j]) > 0.00015)
        return false;
  }
  return JSON.stringify(reference.picks) === JSON.stringify(candidate.picks);
}
export function decision(reference, candidate, guards, config) {
  if (config.metric === "drawCalls") {
    const improvement = 1 - candidate.calls / reference.calls;
    const cpuRegressed =
      candidate.submitP95 > reference.submitP95 * 1.15 &&
      candidate.submitP95 - reference.submitP95 > 0.5;
    const frameRegressed = candidate.frameP95 > reference.frameP95 * 1.15;
    const threshold = config.minImprovement ?? 0.08;
    if (!guards.pass || cpuRegressed || frameRegressed)
      return {
        status: "rejected",
        metric: "drawCalls",
        improvement,
        threshold,
        reason: !guards.pass
          ? "Correctness guard failed."
          : cpuRegressed
            ? "CPU submission regressed. Candidate discarded."
            : "Frame pacing regressed. Candidate discarded.",
      };
    return {
      status: improvement > threshold ? "accepted" : "inconclusive",
      metric: "drawCalls",
      improvement,
      threshold,
      reason:
        improvement > threshold
          ? "Draw calls decreased, correctness checks passed, and CPU submission/frame pacing stayed within their guards."
          : "Draw calls did not improve enough to meet the selected rendering goal.",
    };
  }

  if (!guards.pass)
    return {
      status: "rejected",
      reason: "Correctness guard failed. Candidate was discarded.",
      improvement: 1 - candidate.submitP95 / reference.submitP95,
    };
  const improvement = 1 - candidate.submitP95 / reference.submitP95;
  const repeat = reference.repeatMetrics;
  const median = quantile(repeat, 0.5);
  const spread =
    (quantile(repeat, 0.9) - quantile(repeat, 0.1)) / Math.max(median, 0.001);
  const threshold = Math.max(config.minImprovement ?? 0.08, spread);
  const regression = candidate.frameP95 > reference.frameP95 * 1.15;
  return improvement > threshold && !regression
    ? {
        status: "accepted",
        reason:
          "Correctness checks passed and submission time improved beyond the measured noise band.",
        improvement,
        threshold,
      }
    : {
        status: improvement < -0.08 || regression ? "rejected" : "inconclusive",
        reason: regression
          ? "Frame pacing regressed. Candidate was discarded."
          : "Improvement did not clear the acceptance threshold and reference variability.",
        improvement,
        threshold,
      };
}

export function experimentStrategy(experiments) {
  const categories = {};
  for (const exp of experiments) {
    const text = (exp.title + " " + exp.hypothesis).toLowerCase();
    const category = /instanc|batch/.test(text)
      ? "batching"
      : /material/.test(text)
        ? "material-reuse"
        : /geometry/.test(text)
          ? "geometry-reuse"
          : /vector|allocat/.test(text)
            ? "allocation-reduction"
            : /hoist|precomput|arithmetic|trigon/.test(text)
              ? "loop-arithmetic"
              : "other";
    const record = (categories[category] ??= {
      accepted: 0,
      failedTrials: 0,
      lastReason: "",
    });
    if (exp.status === "accepted") {
      record.accepted++;
      record.failedTrials = 0;
    } else if (
      ["rejected", "inconclusive"].includes(exp.status) &&
      exp.candidate
    )
      record.failedTrials++;
    record.lastReason = exp.reason || record.lastReason;
  }
  return {
    categories,
    exhausted: Object.entries(categories)
      .filter(([k, v]) => v.failedTrials >= 3)
      .map(([k, v]) => ({
        category: k,
        failedTrials: v.failedTrials,
        reason: v.lastReason,
      })),
    guidance:
      "Prioritize different approaches after three unsuccessful measured trials. A failed guard is a repair opportunity, not a measured performance result.",
  };
}
