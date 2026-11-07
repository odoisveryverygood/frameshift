import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { ROOT, DATA } from "../server/core.mjs";
import { workerStatus } from "../server/jobs.mjs";
fs.mkdirSync(DATA, { recursive: true });
const status = await workerStatus();
if (!status.alive) {
  const log = fs.openSync(path.join(DATA, "worker.log"), "a");
  const worker = spawn(
    process.execPath,
    [path.join(ROOT, "server/worker.mjs")],
    {
      cwd: ROOT,
      detached: true,
      stdio: ["ignore", log, log],
      env: process.env,
    },
  );
  worker.unref();
  fs.closeSync(log);
}
const web = spawn(process.execPath, [path.join(ROOT, "server/index.mjs")], {
  cwd: ROOT,
  stdio: "inherit",
  env: process.env,
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => web.kill(signal));
web.on("exit", (code) => process.exit(code || 0));
