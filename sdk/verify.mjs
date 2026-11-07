import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { buildInstrumented } from "../server/integration.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspace = path.join(root, ".frameshift/sdk-smoke");
await fs.mkdir(workspace, { recursive: true });
await fs.cp(path.join(root, "tests/fixtures/plain-three"), workspace, {
  recursive: true,
});
try {
  await fs.symlink(
    path.join(root, "node_modules"),
    path.join(workspace, "node_modules"),
    "dir",
  );
} catch {}
await buildInstrumented(workspace, { outputDir: "dist" });
const app = express();
app.get("/favicon.ico", (req, res) => res.sendStatus(204));
app.use(express.static(path.join(workspace, "dist")));
const server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-webgl", "--ignore-gpu-blocklist"],
});
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 960, height: 640 },
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/?__frameshift=1`);
  await page.waitForFunction(() => window.__frameshift?.ready);
  const states = [];
  states.push(await page.evaluate(() => window.__frameshift.step(0, 0)));
  states.push(await page.evaluate(() => window.__frameshift.step(1, 1)));
  assert.equal(states[0].items.length, 25);
  assert.equal(states[0].calls, 25);
  assert.notDeepEqual(states[0].items[0], states[1].items[0]);
  const metrics = await page.evaluate(() => window.__frameshift.sample(30));
  assert.equal(metrics.frames.length, 30);
  assert.equal(metrics.submit.length, 30);
  assert.ok(metrics.submit.every((n) => Number.isFinite(n) && n >= 0));
  const gpu = await page.evaluate(() => window.__frameshift.gpuSample());
  await page.evaluate(() => window.__frameshift.step(3, 0));
  await page.mouse.click(480, 320);
  const interaction = await page.evaluate(() =>
    window.__frameshift.interactionState(),
  );
  assert.ok(interaction.dom.some((d) => d.label === "selection"));
  const page2 = await context.newPage();
  await page2.goto(`http://127.0.0.1:${server.address().port}/?__frameshift=1`);
  await page2.waitForFunction(() => window.__frameshift?.ready);
  const state2 = await page2.evaluate(() => window.__frameshift.step(0, 0));
  assert.deepEqual(state2.items, states[0].items);
  assert.deepEqual(state2.picks, states[0].picks);
  assert.equal(errors.length, 0, errors.join("; "));
  const result = {
    at: new Date().toISOString(),
    project:
      "Independent plain Vite + Three.js fixture with no FrameShift adapter",
    objects: state2.items.length,
    calls: metrics.calls,
    samples: metrics.frames.length,
    gpuSupported: gpu.supported,
    deterministicState: true,
    actualApplicationSelection: interaction.dom,
    errors,
  };
  await fs.mkdir(path.join(root, "verification"), { recursive: true });
  await fs.writeFile(
    path.join(root, "verification/automatic-sdk.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
