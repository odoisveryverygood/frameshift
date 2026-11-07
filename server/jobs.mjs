import fs from "node:fs/promises";
import path from "node:path";
import { DATA, json, save } from "./core.mjs";
export const workerFile = path.join(DATA, "worker.json");
export function processAlive(pid) {
  if (!Number.isInteger(pid) || pid < 2) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
export async function workerStatus() {
  const info = await json(workerFile, null);
  return info
    ? {
        ...info,
        alive:
          processAlive(info.pid) &&
          Date.now() - Date.parse(info.heartbeat) < 7000,
      }
    : { alive: false, pid: null, heartbeat: null, activeRun: null };
}
export async function projectUpdate(project) {
  const file = path.join(DATA, "projects.json");
  const lock = path.join(DATA, "projects.write-lock");
  await fs.mkdir(DATA, { recursive: true });
  let handle;
  for (let i = 0; i < 80; i++) {
    try {
      handle = await fs.open(lock, "wx");
      await handle.writeFile(String(process.pid));
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      const owner = Number(await fs.readFile(lock, "utf8").catch(() => ""));
      if (owner && !processAlive(owner)) {
        await fs.unlink(lock).catch(() => {});
        continue;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  if (!handle) throw Error("Project store is busy. Retry the action.");
  try {
    const list = await json(file, []);
    const index = list.findIndex((p) => p.id === project.id);
    if (index < 0) list.unshift(project);
    else list[index] = { ...list[index], ...project };
    await save(file, list);
    return list;
  } finally {
    await handle.close();
    await fs.unlink(lock).catch(() => {});
  }
}
export async function promotion(project, run, exp, best, candidate, previous) {
  const file = path.join(DATA, "projects", project.id, "promotion.json");
  await save(file, {
    runId: run.id,
    experiment: exp,
    candidateSummary: exp.candidate,
    best,
    candidate,
    previous,
    preparedAt: new Date().toISOString(),
  });
  await fs.rename(best, previous);
  try {
    await fs.rename(candidate, best);
  } catch (e) {
    await fs.rename(previous, best);
    await fs.unlink(file).catch(() => {});
    throw e;
  }
  return file;
}
export async function recoverPromotions() {
  const list = await json(path.join(DATA, "projects.json"), []);
  for (const project of list) {
    const file = path.join(DATA, "projects", project.id, "promotion.json");
    const record = await json(file, null);
    if (!record) continue;
    for (const name of ["best", "candidate", "previous"])
      if (!path.resolve(record[name]).startsWith(DATA + path.sep))
        throw Error("Invalid promotion recovery path");
    const exists = async (p) => Boolean(await fs.stat(p).catch(() => null));
    if (!(await exists(record.best)) && (await exists(record.candidate)))
      await fs.rename(record.candidate, record.best);
    if (!(await exists(record.best)) && (await exists(record.previous))) {
      await fs.rename(record.previous, record.best);
      await fs.unlink(file);
      continue;
    }
    if ((await exists(record.best)) && !(await exists(record.candidate))) {
      const runPath = path.join(DATA, "runs", record.runId, "run.json");
      const run = await json(runPath, null);
      if (run) {
        const index = run.experiments.findIndex(
          (e) => e.id === record.experiment.id,
        );
        if (index >= 0) run.experiments[index] = record.experiment;
        else run.experiments.push(record.experiment);
        run.best = record.candidateSummary;
        run.events.push({
          at: new Date().toISOString(),
          type: "recovery",
          message:
            "Recovered a verified workspace promotion after interruption.",
        });
        await save(runPath, run);
      }
      project.lastAcceptedRun = record.runId;
      project.lastAcceptedExperiment = record.experiment.id;
      await projectUpdate(project);
    }
    await fs.unlink(file).catch(() => {});
  }
}
