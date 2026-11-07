import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import { ROOT, DATA, json, save } from "./core.mjs";
import {
  initialize,
  projects,
  runs,
  processJob,
  persistRun,
  abortCurrent,
} from "./runner.mjs";
import { processAlive, workerFile, recoverPromotions } from "./jobs.mjs";
await fs.mkdir(DATA, { recursive: true });
const lock = path.join(DATA, "worker.lock");
let handle;
for (let attempt = 0; attempt < 2; attempt++) {
  try {
    handle = await fs.open(lock, "wx");
    await handle.writeFile(String(process.pid));
    break;
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    const owner = Number(await fs.readFile(lock, "utf8").catch(() => ""));
    if (processAlive(owner)) {
      console.log("A FrameShift worker is already running.");
      process.exit(0);
    }
    await fs.unlink(lock).catch(() => {});
  }
}
if (!handle) throw Error("Cannot claim worker lock");
let closing = false;
let active = null;
async function heartbeat() {
  await save(workerFile, {
    pid: process.pid,
    heartbeat: new Date().toISOString(),
    activeRun: active,
    startedAt,
  });
}
const startedAt = new Date().toISOString();
const pulse = setInterval(() => heartbeat().catch(() => {}), 1000);
async function cleanup() {
  closing = true;
  clearInterval(pulse);
  await handle.close();
  await fs.unlink(lock).catch(() => {});
  await save(workerFile, {
    pid: process.pid,
    heartbeat: new Date().toISOString(),
    activeRun: active,
    alive: false,
    stopped: true,
  });
  process.exit(0);
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    closing = true;
    abortCurrent();
  });
await recoverPromotions();
await initialize();
for (const run of runs.filter((r) =>
  ["running", "recovering"].includes(r.status),
)) {
  run.recoveries = (run.recoveries || 0) + 1;
  for (const exp of run.experiments)
    if (
      !["accepted", "rejected", "inconclusive", "interrupted"].includes(
        exp.status,
      )
    ) {
      exp.status = "interrupted";
      exp.reason =
        "Worker interrupted; attempt preserved and safe checkpoint will be resumed";
    }
  run.status = run.recoveries <= 3 ? "queued" : "failed";
  run.phase =
    run.status === "queued"
      ? "Recovering from the last safe checkpoint"
      : "Worker recovery limit reached";
  run.events.push({
    at: new Date().toISOString(),
    type: "recovery",
    message: run.phase,
  });
  await persistRun(run);
}
await heartbeat();
console.log("FrameShift worker ready:", process.pid);
while (!closing) {
  await initialize();
  const next = runs
    .filter((r) => r.status === "queued")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  if (next) {
    active = next.id;
    await heartbeat();
    dotenv.config({
      path: path.join(ROOT, ".env.local"),
      override: true,
      quiet: true,
    });
    try {
      await processJob(next);
    } catch (e) {
      next.status = "failed";
      next.error = String(e.message).replace(/sk-[\w-]+/g, "[redacted]");
      await persistRun(next);
    }
    active = null;
    await heartbeat();
  } else await new Promise((r) => setTimeout(r, 400));
}

await cleanup();
