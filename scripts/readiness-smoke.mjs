#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { PNG } from "pngjs";

const execute = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function parseOptions(args) {
  let output;
  let timeout = 180000;
  let help = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--help" || args[i] === "-h") help = true;
    else if (
      args[i] === "--output" &&
      args[i + 1] &&
      !args[i + 1].startsWith("--")
    )
      output = path.resolve(args[++i]);
    else if (args[i] === "--timeout" && /^\d+$/.test(args[i + 1] || ""))
      timeout = Number(args[++i]) * 1000;
    else
      throw Error(
        "Usage: node scripts/readiness-smoke.mjs [--output folder] [--timeout seconds]",
      );
  }
  if (timeout < 1000 || timeout > 600000)
    throw Error("--timeout must be 1–600 seconds.");
  return { output, timeout, help };
}

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

export async function main(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  if (options.help) {
    console.log(
      "Usage: node scripts/readiness-smoke.mjs [--output folder] [--timeout seconds]\nInstall Earl and Orbit Lab dependencies and build Earl first. Runs a real, model-free profile in a temporary Earl copy. Saves a JSON receipt and browser screenshots. Never connects to an existing Earl service.",
    );
    return;
  }
  const output =
    options.output ||
    path.join(
      ROOT,
      ".frameshift",
      "readiness-results",
      `${Date.now()}-${process.pid}`,
    );
  await fs.mkdir(output, { recursive: true });
  const temp = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "earl-readiness-")),
  );
  const earl = path.join(temp, "earl");
  const project = path.join(temp, "orbit-lab");
  const processes = [];
  const checks = [];
  const receipt = {
    at: new Date().toISOString(),
    pass: false,
    kind: "live-local-authored-demo",
    modelCalls: 0,
    checks,
    limits: [
      "Profiles an authored local application; no AI optimization, patch acceptance, Apply, or third-party generalization is asserted.",
      "Browser checks use headless desktop Chrome and an emulated mobile viewport, not a physical phone.",
    ],
  };
  const controller = new AbortController();
  const interrupt = () => {
    controller.abort(Error("Smoke check interrupted."));
    browser?.close().catch(() => {});
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  let browser;
  let stage = "prerequisites";
  // No provider keys, user .env files, or persisted Earl workspaces enter the copy.
  const env = Object.fromEntries(
    [
      "PATH",
      "LANG",
      "LC_ALL",
      "TMPDIR",
      "SYSTEMROOT",
      "SystemRoot",
      "COMSPEC",
      "PATHEXT",
      "PROGRAMFILES",
      "PROGRAMFILES(X86)",
      "LOCALAPPDATA",
    ]
      .filter((name) => process.env[name])
      .map((name) => [name, process.env[name]]),
  );
  env.NODE_ENV = "production";
  const check = (name, details = {}) => {
    checks.push({ name, pass: true, ...details });
    console.log(`PASS ${name}`);
  };
  const run = async (script, argv, cwd = earl) => {
    try {
      return await execute(process.execPath, [script, ...argv], {
        cwd,
        env,
        timeout: 120000,
        maxBuffer: 2 * 1024 * 1024,
        signal: controller.signal,
      });
    } catch (error) {
      throw Error(
        `${path.basename(script)} failed: ${(error.stderr || error.stdout || error.message).slice(-4000)}`,
      );
    }
  };
  const launch = (script) => {
    const child = spawn(process.execPath, [script], {
      cwd: earl,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    const record = { child, log: "", error: null, exited: false };
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (data) => {
        record.log = (record.log + data).slice(-8000);
      });
    child.on("error", (error) => {
      record.error = error;
    });
    child.on("exit", () => {
      record.exited = true;
    });
    processes.push(record);
  };
  const alive = () => {
    controller.signal.throwIfAborted();
    for (const record of processes)
      if (record.error || record.exited)
        throw Error(
          `Isolated Earl process exited: ${record.error?.message || record.log}`,
        );
  };
  try {
    await fs.access(path.join(ROOT, "dist/index.html")).catch(() => {
      throw Error(
        "Build Earl first: npm run build (from the repository root).",
      );
    });
    await fs
      .access(path.join(ROOT, "node_modules/playwright-core/package.json"))
      .catch(() => {
        throw Error("Install Earl dependencies first: npm ci.");
      });
    await fs
      .access(
        path.join(ROOT, "examples/orbit-lab/node_modules/vite/bin/vite.js"),
      )
      .catch(() => {
        throw Error(
          "Install Orbit Lab dependencies first: npm ci --prefix examples/orbit-lab.",
        );
      });
    await fs.mkdir(earl);
    for (const name of ["server", "scripts", "sdk", "dist", "package.json"])
      await fs.cp(path.join(ROOT, name), path.join(earl, name), {
        recursive: true,
      });
    // Copy the runtime dependencies: macOS build isolation only allows this Earl root.
    // A root-level symlink back into the user checkout would escape that boundary.
    await fs.cp(
      path.join(ROOT, "node_modules"),
      path.join(earl, "node_modules"),
      { recursive: true, verbatimSymlinks: true },
    );
    await fs.cp(path.join(ROOT, "examples/orbit-lab"), project, {
      recursive: true,
      filter: (file) =>
        !path
          .relative(path.join(ROOT, "examples/orbit-lab"), file)
          .split(path.sep)
          .some(
            (part) =>
              ["node_modules", "dist", ".git"].includes(part) ||
              part.startsWith(".env"),
          ),
    });
    await fs.symlink(
      path.join(ROOT, "examples/orbit-lab/node_modules"),
      path.join(project, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );

    stage = "doctor positive and negative CLI checks";
    const doctor = path.join(earl, "scripts/doctor.mjs");
    const positive = JSON.parse(
      (await run(doctor, [project + "  ", "--json"])).stdout,
    );
    assert.equal(positive.ready, true, JSON.stringify(positive.findings));
    check("doctor accepts installed Orbit Lab with trailing whitespace");
    const negative = await execute(
      process.execPath,
      [doctor, path.join(temp, "missing"), "--json"],
      { cwd: earl, env, timeout: 15000 },
    ).then(
      () => {
        throw Error("Doctor incorrectly accepted a missing folder.");
      },
      (error) => {
        assert.equal(error.code, 1, error.message);
        return JSON.parse(error.stdout);
      },
    );
    assert.equal(negative.ready, false);
    assert.ok(
      negative.findings.some((finding) => finding.code === "FOLDER_NOT_FOUND"),
    );
    check(
      "doctor blocks a missing project with exit 1 and structured remediation",
    );
    receipt.doctor = positive;

    stage = "standalone demo build";
    const build = await run(
      path.join(project, "node_modules/vite/bin/vite.js"),
      ["build"],
      project,
    );
    await fs.access(path.join(project, "dist/index.html"));
    check("Orbit Lab builds from its own directory");
    await fs.writeFile(
      path.join(output, "demo-build.log"),
      build.stdout + build.stderr,
    );

    stage = "isolated Earl startup";
    env.PORT = String(await unusedPort());
    const origin = `http://127.0.0.1:${env.PORT}`;
    const request = async (route, body) => {
      const response = await fetch(origin + route, {
        method: body === undefined ? "GET" : "POST",
        ...(body === undefined
          ? {}
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
      });
      const data = await response.json();
      if (!response.ok)
        throw Error(data.error || `HTTP ${response.status} at ${route}`);
      return data;
    };
    launch(path.join(earl, "server/worker.mjs"));
    launch(path.join(earl, "server/index.mjs"));
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      alive();
      const state = await request("/api/state").catch((error) => {
        if (error.cause?.code === "ECONNREFUSED") return null;
        throw error;
      });
      if (state?.worker?.alive) {
        assert.equal(state.root, earl);
        ready = true;
        break;
      }
      await delay(250);
    }
    assert.ok(
      ready,
      "The isolated server/worker did not become ready within 20 seconds.",
    );
    check(
      "temporary Earl service and worker start with their own empty job store",
    );

    stage = "existing local connection CLI";
    const connected = JSON.parse(
      (
        await run(path.join(earl, "scripts/open.mjs"), [
          project + "  ",
          "--no-browser",
          "--json",
          "--port",
          env.PORT,
        ])
      ).stdout,
    );
    const projectId = connected.projectId;
    assert.ok(projectId);
    assert.equal(new URL(connected.url).searchParams.get("project"), projectId);
    check(
      "existing open CLI connects the real project and returns its workspace URL",
    );

    stage = "real profile and automatic instrumentation";
    const job = await request(`/api/projects/${projectId}/runs`, {
      kind: "profile",
    });
    const deadline = Date.now() + options.timeout;
    let profile;
    while (Date.now() < deadline) {
      alive();
      const state = await request("/api/state");
      const run = state.runs.find((item) => item.id === job.id);
      if (run && !["queued", "running", "recovering"].includes(run.status)) {
        profile = run;
        break;
      }
      await delay(500);
    }
    assert.ok(
      profile,
      `Profile ${job.id} timed out after ${options.timeout / 1000}s.`,
    );
    assert.equal(
      profile.status,
      "completed",
      profile.error || profile.buildLog || profile.phase,
    );
    assert.ok(
      Number.isFinite(profile.baseline?.calls) && profile.baseline.calls >= 241,
      "Profile did not measure the authored satellites and beacon.",
    );
    assert.ok(
      Number.isFinite(profile.baseline.submitP95) &&
        profile.baseline.submitP95 >= 0,
    );
    assert.ok(
      profile.baseline.frameCount >= 60,
      "Expected real browser timing samples.",
    );
    assert.deepEqual(
      profile.experiments,
      [],
      "A profile must not invoke AI optimization.",
    );
    receipt.profile = {
      runId: profile.id,
      status: profile.status,
      baseline: profile.baseline,
    };
    await fs.copyFile(
      path.join(earl, ".frameshift/runs", job.id, "baseline-0.png"),
      path.join(output, "baseline.png"),
    );
    check(
      "real automatic profile completes with timings, draw calls and baseline image",
      { runId: job.id, calls: profile.baseline.calls },
    );

    stage = "real preview browser interactions";
    browser = await chromium.launch({
      channel: "chrome",
      headless: true,
      args: ["--enable-webgl", "--ignore-gpu-blocklist"],
    });
    const page = await browser.newPage({
      viewport: { width: 1100, height: 800 },
      deviceScaleFactor: 1,
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    const response = await page.goto(`${origin}/preview/${projectId}/`, {
      waitUntil: "networkidle",
    });
    assert.ok(response.ok(), `Preview returned ${response.status()}`);
    await page.waitForFunction(() => window.__frameshift?.ready === true);
    const canvas = page.locator("canvas");
    const box = await canvas.boundingBox();
    assert.ok(
      box?.width > 300 && box.height > 300,
      "Preview canvas has no usable viewport.",
    );
    const image = PNG.sync.read(await canvas.screenshot());
    const colors = new Set();
    for (let i = 0; i < image.data.length; i += 16)
      colors.add(`${image.data[i]},${image.data[i + 1]},${image.data[i + 2]}`);
    assert.ok(colors.size > 20, "Canvas screenshot is blank or uniform.");
    const positions = () =>
      page.evaluate(() =>
        window.__frameshift
          .listObjects()
          .filter((object) => object.name.startsWith("Satellite "))
          .map((object) => [object.id, object.position]),
      );
    const moving = await positions();
    assert.equal(moving.length, 240);
    await page.waitForFunction((before) => {
      const after = window.__frameshift
        .listObjects()
        .filter((object) => object.name.startsWith("Satellite "));
      return (
        after.length === before.length &&
        after.every(
          (object, index) =>
            object.id === before[index][0] &&
            object.position.some(
              (value, axis) => value !== before[index][1][axis],
            ),
        )
      );
    }, moving);
    check(
      "preview renders a nonblank WebGL canvas and all 240 satellites animate",
    );

    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction(
      () =>
        document.querySelector("#selection").textContent === "Selected: Beacon",
    );
    check("a real canvas click changes visible selection to Beacon");
    await page.getByRole("button", { name: "Pause orbits" }).click();
    await page.waitForFunction(
      () => document.querySelector("#motion").textContent === "Orbits paused",
    );
    const frozen = await positions();
    await page.waitForTimeout(250);
    assert.deepEqual(
      await positions(),
      frozen,
      "Satellites continued moving while paused.",
    );
    assert.equal(
      await page.locator("#pause").getAttribute("aria-pressed"),
      "true",
    );
    await page.screenshot({ path: path.join(output, "preview-desktop.png") });
    await page.getByRole("button", { name: "Resume orbits" }).click();
    await page.waitForFunction(
      () => document.querySelector("#motion").textContent === "Orbits running",
    );
    await page.waitForFunction(
      (before) =>
        JSON.stringify(
          window.__frameshift
            .listObjects()
            .filter((object) => object.name.startsWith("Satellite "))
            .map((object) => [object.id, object.position]),
        ) !== before,
      JSON.stringify(frozen),
    );
    check("pause freezes actual object positions and resume restarts motion");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => {
      const canvas = document.querySelector("canvas");
      const bounds = document
        .querySelector("#viewport")
        .getBoundingClientRect();
      return (
        Math.abs(canvas.width - bounds.width) <= 1 &&
        Math.abs(canvas.height - bounds.height) <= 1
      );
    });
    const mobile = await canvas.boundingBox();
    assert.ok(
      mobile.width >= 380 && mobile.height >= 300,
      "Mobile canvas is unusable.",
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "Mobile preview overflows horizontally.",
    );
    await canvas.focus();
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator("#selection").textContent(),
      "Nothing selected",
    );
    await page.mouse.click(
      mobile.x + mobile.width / 2,
      mobile.y + mobile.height / 2,
    );
    await page.waitForFunction(
      () =>
        document.querySelector("#selection").textContent === "Selected: Beacon",
    );
    await page.screenshot({
      path: path.join(output, "preview-mobile.png"),
      fullPage: true,
    });
    check(
      "390px resize updates the canvas and picking without horizontal overflow",
    );
    await page.keyboard.press("Escape");
    await page.keyboard.press("Enter");
    assert.equal(
      await page.locator("#selection").textContent(),
      "Selected: Beacon",
    );
    check("keyboard selection and clear controls work");
    assert.deepEqual(errors, [], "Browser reported runtime/console errors.");
    check("browser has no runtime or console errors");
    receipt.pass = true;
  } catch (error) {
    const message = controller.signal.aborted
      ? controller.signal.reason.message
      : error.message;
    receipt.failure = { stage, message };
    process.exitCode = 1;
    console.error(`FAIL ${stage}: ${message}`);
  } finally {
    await browser?.close().catch(() => {});
    // Only these child processes and this mkdtemp tree belong to this invocation.
    for (const { child } of processes)
      if (child.exitCode === null) child.kill("SIGTERM");
    const deadline = Date.now() + 10000;
    while (
      processes.some(({ exited, error }) => !exited && !error) &&
      Date.now() < deadline
    )
      await delay(100);
    for (const { child, exited } of processes)
      if (!exited) {
        try {
          if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
          else child.kill("SIGKILL");
        } catch {
          /* Already exited. */
        }
      }
    await fs.writeFile(
      path.join(output, "service.log"),
      processes.map(({ log }) => log).join("\n"),
    );
    await fs.writeFile(
      path.join(output, "result.json"),
      JSON.stringify(receipt, null, 2) + "\n",
    );
    await fs.rm(temp, { recursive: true, force: true });
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    console.log(`Smoke evidence: ${output}`);
  }
  return receipt;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(`FAIL smoke setup: ${error.message}`);
    process.exitCode = 1;
  });
}
