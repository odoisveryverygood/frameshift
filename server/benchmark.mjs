import { chromium } from "playwright-core";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { summarize, compareState } from "./core.mjs";
export async function withPage(directory, signal, callback) {
  const app = express();
  app.get("/favicon.ico", (req, res) => res.status(204).end());
  app.use(express.static(directory));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  let browser;
  const abort = () => browser?.close().catch(() => {});
  try {
    browser = await chromium.launch({
      ...(process.env.CHROME_EXECUTABLE_PATH ? {executablePath:process.env.CHROME_EXECUTABLE_PATH} : {channel:"chrome"}),
      headless: true,
      args: ["--enable-webgl", "--ignore-gpu-blocklist"],
    });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) throw Error("Run stopped");
    const context = await browser.newContext({
      viewport: { width: 960, height: 640 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return ["127.0.0.1", "localhost"].includes(url.hostname) &&
        Number(url.port) === server.address().port
        ? route.continue()
        : route.abort("blockedbyclient");
    });
    await page.goto(
      "http://127.0.0.1:" + server.address().port + "/?__frameshift=1",
      {
        waitUntil: "networkidle",
      },
    );
    await page.waitForFunction(
      () => window.__frameshift?.ready === true,
      {},
      { timeout: 20000 },
    );
    return await callback(page, errors);
  } finally {
    signal?.removeEventListener("abort", abort);
    await browser?.close();
    await new Promise((r) => server.close(r));
  }
}
export async function measure(directory, config, signal, onSample = () => {}) {
  return withPage(directory, signal, async (page, errors) => {
    const samples = [];
    for (let i = 0; i < (config.repeats ?? 3); i++) {
      if (signal?.aborted) throw Error("Run stopped");
      const s = await page.evaluate(
        (n) => window.__frameshift.sample(n),
        config.samples ?? 80,
      );
      if (
        !Array.isArray(s.frames) ||
        !Array.isArray(s.submit) ||
        s.frames.length < 20 ||
        s.submit.length !== s.frames.length ||
        s.frames.some((x) => !Number.isFinite(x) || x <= 0) ||
        !Number.isFinite(s.calls) ||
        s.calls < 1 ||
        s.submit.some((x) => !Number.isFinite(x) || x < 0)
      )
        throw Error("Adapter returned invalid timing samples");
      s.hardware = await page.evaluate(() => ({
        userAgent: navigator.userAgent,
        cores: navigator.hardwareConcurrency,
        viewport: [innerWidth, innerHeight],
        dpr: devicePixelRatio,
      }));
      if (process.env.EARL_HOSTED === "1") Object.assign(s.hardware, {executionEnvironment:"operator-hosted-container",graphicsCaveat:"Container graphics may use software rendering; results apply to this execution environment, not every physical GPU."});
      samples.push(s);
      onSample(i, s);
    }
    const gpu = await page.evaluate(async () =>
      typeof window.__frameshift.gpuSample === "function"
        ? await window.__frameshift.gpuSample()
        : { supported: false, times: [] },
    );
    if (errors.length)
      throw Error("Runtime errors: " + errors.slice(0, 3).join("; "));
    return {
      summary: {
        ...summarize(samples),
        gpuSupported: gpu.supported,
        gpuP95: gpu.times.length
          ? gpu.times.sort((a, b) => a - b)[Math.floor(gpu.times.length * 0.95)]
          : null,
      },
      gpu,
      raw: samples,
      conditions: {
        viewport: [960, 640],
        dpr: 1,
        mode: "headless Chrome",
        metric: "CPU update + render submission time; not GPU utilization",
        timestamp: new Date().toISOString(),
      },
    };
  });
}
const defaultCheckpoints = [
  { time: 0, view: 0 },
  { time: 0.6, view: 1 },
  { time: 1.2, view: 2 },
  { time: 2, view: 0 },
  { time: 3, view: 1 },
  { time: 4.2, view: 2 },
  { time: 5, view: 0 },
  { time: 6, view: 1 },
];
export async function capture(
  directory,
  artifactDir,
  prefix,
  signal,
  config = {},
  referenceCapture = null,
) {
  await fs.mkdir(artifactDir, { recursive: true });
  const checkpoints = config.checkpoints || defaultCheckpoints;
  const result = await withPage(directory, signal, async (page, errors) => {
    const states = [];
    for (const [index, point] of checkpoints.entries()) {
      const state = await page.evaluate(
        ([t, v, camera]) => window.__frameshift.step(t, v, camera),
        [point.time, point.view, referenceCapture?.states[index]?.cameraState],
      );
      if (
        !Array.isArray(state?.items) ||
        !state.items.length ||
        !Array.isArray(state.picks)
      )
        throw Error(
          "Profiler cannot read scene state. Check the Three.js integration.",
        );
      state.checkpoint = point;
      states.push(state);
      await page.screenshot({
        path: path.join(artifactDir, `${prefix}-${index}.png`),
      });
    }
    const geometry = await page.evaluate(async () => typeof window.__frameshift.meshFingerprint === "function" ? await window.__frameshift.meshFingerprint() : null);
    if(config.requireMeshFingerprint && !geometry) throw Error("This imported mesh requires protected geometry fingerprints.");
    return { states, errors, geometry };
  });
  const events = config.scenario?.events || [];
  if (events.length) {
    result.interaction = await withPage(
      directory,
      signal,
      async (page, errors) => {
        const canvas = page.locator("canvas").first();
        const box = await canvas.boundingBox();
        if (!box) throw Error("No visible canvas for interaction replay");
        for (const event of events) {
          await page.evaluate(
            (t) => window.__frameshift.step(t, 0),
            Math.max(0, Number(event.at) || 0),
          );
          const x = box.x + (event.x ?? 0.5) * box.width,
            y = box.y + (event.y ?? 0.5) * box.height;
          if (event.type === "click") await page.mouse.click(x, y);
          else if (event.type === "pointermove") await page.mouse.move(x, y);
          else if (event.type === "pointerdown") {
            await page.mouse.move(x, y);
            await page.mouse.down();
          } else if (event.type === "pointerup") {
            await page.mouse.move(x, y);
            await page.mouse.up();
          } else if (event.type === "keydown")
            await page.keyboard.down(event.key);
          else if (event.type === "keyup") await page.keyboard.up(event.key);
          else if (event.type === "wheel")
            await page.mouse.wheel(0, event.deltaY || 0);
        }
        const state = await page.evaluate(
          (t) => window.__frameshift.step(t, 0),
          (events.at(-1).at || 0) + 0.1,
        );
        await page.screenshot({
          path: path.join(artifactDir, `${prefix}-interaction.png`),
        });
        return { state, events: events.length, errors };
      },
    );
  }
  return result;
}
export function compareGeometryEvidence(reference, candidate, required = false) {
  if (!reference && !candidate && !required) return {checked:false,pass:true,scope:"Geometry fingerprints are not exposed by this application"};
  const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
  const valid=value=>value?.version===1 && Array.isArray(value.components) && value.components.length>0;
  const pass=valid(reference)&&valid(candidate)&&JSON.stringify(stable(reference))===JSON.stringify(stable(candidate));
  return {checked:true,pass,scope:"Protected per-shell world-space triangle fingerprints at the captured state",reason:pass?"Actual mesh geometry and identities match":"Missing or changed mesh geometry, triangle coverage or shell identity"};
}
export async function verify(reference, candidate, artifactDir, config) {
  const checks = [];
  for (let i = 0; i < reference.states.length; i++) {
    const a = PNG.sync.read(
      await fs.readFile(path.join(artifactDir, `reference-${i}.png`)),
    );
    const b = PNG.sync.read(
      await fs.readFile(path.join(artifactDir, `candidate-${i}.png`)),
    );
    if (a.width !== b.width || a.height !== b.height)
      throw Error("Screenshot dimensions changed");
    const diff = new PNG({ width: a.width, height: a.height });
    const pixels = pixelmatch(a.data, b.data, diff.data, a.width, a.height, {
      threshold: 0.12,
      includeAA: false,
    });
    await fs.writeFile(
      path.join(artifactDir, `diff-${i}.png`),
      PNG.sync.write(diff),
    );
    const ratio = pixels / (a.width * a.height);
    const expected = reference.states[i];
    const actual = candidate.states[i];
    let mismatch = null;
    for (let j = 0; j < expected.items.length; j++) {
      const a = expected.items[j],
        b = actual.items[j];
      if (
        !b ||
        a[0] !== b[0] ||
        a
          .slice(1)
          .some(
            (n, k) =>
              !Number.isFinite(b[k + 1]) || Math.abs(n - b[k + 1]) > 0.00015,
          )
      ) {
        mismatch = { expected: a, actual: b ?? null };
        break;
      }
    }
    checks.push({
      firstTransformMismatch: mismatch,
      view: i,
      time: reference.states[i].checkpoint?.time ?? i,
      cameraPass:
        !reference.states[i].camera ||
        !candidate.states[i].camera ||
        (reference.states[i].camera.length ===
          candidate.states[i].camera.length &&
          reference.states[i].camera.every(
            (n, j) =>
              Number.isFinite(candidate.states[i].camera[j]) &&
              Math.abs(n - candidate.states[i].camera[j]) < 0.00015,
          )),
      visualDifference: ratio,
      visualPass: ratio <= (config.maxVisualDifference ?? 0.01),
      statePass: compareState(reference.states[i], candidate.states[i]),
      objectCount: candidate.states[i].items.length,
      pickingPass:
        JSON.stringify(reference.states[i].picks) ===
        JSON.stringify(candidate.states[i].picks),
    });
  }
  const interactions = reference.interaction
    ? {
        events: reference.interaction.events,
        statePass:
          Boolean(candidate.interaction?.state) &&
          compareState(
            reference.interaction.state,
            candidate.interaction.state,
          ),
        behaviorPass:
          JSON.stringify(reference.interaction.state.interactionState) ===
          JSON.stringify(candidate.interaction?.state?.interactionState),
        errors: candidate.interaction?.errors || [
          "Interaction replay was not captured",
        ],
      }
    : null;
  const geometry = compareGeometryEvidence(reference.geometry,candidate.geometry,Boolean(config.requireMeshFingerprint));
  return {
    interactions,
    geometry,
    coverage: {
      checkpoints: reference.states.length,
      semanticObjects: reference.states[0]?.items.length,
      pickingProbes: reference.states.reduce((n, s) => n + s.picks.length, 0),
      replayedEvents: interactions?.events || 0,
    },
    pass:
      geometry.pass &&
      checks.every((c) => c.visualPass && c.statePass && c.cameraPass) &&
      !candidate.errors.length &&
      (!interactions ||
        (interactions.statePass &&
          interactions.behaviorPass &&
          !interactions.errors.length)),
    checks,
    errors: candidate.errors,
  };
}

export async function measurePair(referenceDir, candidateDir, config, signal) {
  const reference = [],
    candidate = [],
    gpuA = [],
    gpuB = [],
    order = [];
  for (let repeat = 0; repeat < (config.repeats || 3); repeat++) {
    for (const which of repeat % 2
      ? ["candidate", "reference"]
      : ["reference", "candidate"]) {
      const result = await measure(
        which === "reference" ? referenceDir : candidateDir,
        { ...config, repeats: 1 },
        signal,
      );
      (which === "reference" ? reference : candidate).push(...result.raw);
      (which === "reference" ? gpuA : gpuB).push(...result.gpu.times);
      order.push({
        repeat: repeat + 1,
        version: which,
        at: new Date().toISOString(),
      });
    }
  }
  function result(samples, gpu) {
    const summary = summarize(samples);
    const values = summary.repeatMetrics;
    const mid = values.slice().sort((a, b) => a - b)[
      Math.floor(values.length / 2)
    ];
    summary.uncertainty = {
      repeats: values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      relativeSpread:
        (Math.max(...values) - Math.min(...values)) / Math.max(mid, 0.001),
      note:
        values.length < 5
          ? "Limited repeat count; differences inside observed variability are inconclusive."
          : "Repeat-level variability is used for acceptance; one device is not a hardware study.",
    };
    const times = gpu.slice().sort((a, b) => a - b);
    summary.gpuSupported = Boolean(times.length);
    summary.gpuP95 = times.length
      ? times[Math.floor(times.length * 0.95)]
      : null;
    return {
      summary,
      raw: samples,
      gpu: { supported: summary.gpuSupported, times },
      conditions: {
        mode: "headless Chrome",
        viewport: [960, 640],
        dpr: 1,
        order: "alternating A/B then B/A",
        timestamp: new Date().toISOString(),
      },
    };
  }
  return {
    reference: result(reference, gpuA),
    candidate: result(candidate, gpuB),
    order,
  };
}
