import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { ROOT, DATA } from "../server/core.mjs";
import { workerStatus } from "../server/jobs.mjs";

fs.mkdirSync(DATA, { recursive: true });
let shuttingDown = false;
let restartTimer;
let shortFailures = 0;

function launchWorker() {
  if (shuttingDown) return;
  const logPath = path.join(DATA, "worker.log");
  const log = fs.openSync(logPath, "a", 0o600);
  const startedAt = Date.now();
  let handledExit = false;
  let worker;
  const recover = (reason) => {
    if (handledExit || shuttingDown) return;
    handledExit = true;
    if (Date.now() - startedAt > 30000) shortFailures = 0;
    shortFailures++;
    if (shortFailures > 5) {
      console.error(
        `Earl worker stopped repeatedly (${reason}). Restart Earl after checking ${logPath}`,
      );
      return;
    }
    const delay = Math.min(10000, 1000 * 2 ** (shortFailures - 1));
    console.error(
      `Earl worker stopped (${reason}); restarting in ${delay / 1000}s. Details: ${logPath}`,
    );
    restartTimer = setTimeout(async () => {
      try {
        // A second starter may already have recovered the singleton worker.
        if (!shuttingDown && !(await workerStatus()).alive) launchWorker();
      } catch (error) {
        console.error(`Earl worker recovery failed: ${error.message}`);
      }
    }, delay);
  };
  try {
    worker = spawn(process.execPath, [path.join(ROOT, "server/worker.mjs")], {
      cwd: ROOT,
      detached: true,
      stdio: ["ignore", log, log],
      env: process.env,
    });
    worker.on("error", (error) => recover(error.message));
    worker.on("exit", (code, signal) => recover(signal || `exit ${code}`));
    worker.unref();
  } finally {
    fs.closeSync(log);
  }
}

if (!(await workerStatus()).alive) launchWorker();
const web = spawn(process.execPath, [path.join(ROOT, "server/index.mjs")], {
  cwd: ROOT,
  stdio: "inherit",
  env: process.env,
});
function shutdown(signal) {
  shuttingDown = true;
  clearTimeout(restartTimer);
  web.kill(signal);
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => shutdown(signal));
web.on("error", (error) => {
  shuttingDown = true;
  clearTimeout(restartTimer);
  console.error(`Earl could not start: ${error.message}`);
  process.exitCode = 1;
});
web.on("exit", (code, signal) => {
  shuttingDown = true;
  clearTimeout(restartTimer);
  process.exit(code ?? (signal ? 1 : 0));
});
