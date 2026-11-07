import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT, DATA, id, json, save, safeFile } from "../core.mjs";
import { provider } from "../model.mjs";
import { listFixtures, evaluateSkill, adoptionDecision, trainingGeometryVariant, trainingHierarchyVariant } from "./evaluate.mjs";
import { generateSkill, trainingContext } from "./generator.mjs";

export const LAB = path.join(DATA, "skill-lab");
const digest = (v) => crypto.createHash("sha256").update(v).digest("hex");
const cleanError = (e) => String(e?.message || e).replace(/sk-[\w-]+/g, "[redacted]").slice(0, 3000);
const terminal = new Set(["completed", "failed", "stopped"]);
const validId = (value) => typeof value === "string" && /^[\w-]{1,60}$/.test(value);
let creating = false;
let activeController = null;
export function abortLabCurrent() { activeController?.abort(); }
export function labRunDir(runId) {
  if (!validId(runId)) throw Error("Invalid skill-lab run identifier");
  return path.join(LAB, "runs", runId);
}
export async function getLabRun(runId) {
  return json(path.join(labRunDir(runId), "run.json"), null);
}
export async function getSkill(skillId) {
  if (!validId(skillId)) throw Error("Invalid skill identifier");
  return json(path.join(LAB, "skills", skillId + ".json"), null);
}
async function persist(run) {
  run.updatedAt = new Date().toISOString();
  await save(path.join(labRunDir(run.id), "run.json"), run);
}
async function record(run, message, type = "progress") {
  run.phase = message;
  run.events.push({ at: new Date().toISOString(), type, message });
  await persist(run);
}
export async function labState() {
  await fs.mkdir(path.join(LAB, "runs"), { recursive: true });
  await fs.mkdir(path.join(LAB, "skills"), { recursive: true });
  const runs = [];
  for (const name of await fs.readdir(path.join(LAB, "runs"))) {
    if (!validId(name)) continue;
    const run = await getLabRun(name);
    if (run) runs.push(run);
  }
  runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const skills = [];
  for (const name of await fs.readdir(path.join(LAB, "skills"))) {
    if (!name.endsWith(".json")) continue;
    const skill = await getSkill(name.slice(0, -5));
    if (skill) {
      const { code, ...summary } = skill;
      skills.push(summary);
    }
  }
  skills.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const registry = await json(path.join(LAB, "registry.json"), { activeSkillId: null });
  return {
    fixtures: listFixtures().map(({ id, name, split }) => ({ id, name, split })),
    skills,
    runs,
    activeRun: runs.find((r) => r.status === "running")?.id || null,
    activeSkillId: registry.activeSkillId,
    provider: provider(),
    limitations: ["Authored fixtures held out from the generator, not independent customer data.", "The fixed evaluation suite is reused across runs; this is not proof of generalization to all projects.", "Skill versions change executable transformation logic, not model weights."],
  };
}
export async function startLabRun({ trainingFixtureId = "training-cells", maxAttempts = 2 } = {}) {
  if (creating) throw Error("A skill discovery run is being queued. Retry shortly.");
  creating = true;
  try {
  if (!provider().configured) throw Error("Configure the model provider in Earl before discovering a skill.");
  const fixture = listFixtures().find((f) => f.id === trainingFixtureId && f.split === "training");
  if (!fixture) throw Error("Select a training fixture. Held-out projects cannot be used for skill generation.");
  const state = await labState();
  if (state.runs.some((r) => !terminal.has(r.status))) throw Error("A skill discovery run is already queued or running.");
  const run = {
    id: id(), status: "queued", createdAt: new Date().toISOString(),
    trainingFixtureId, maxAttempts: Math.max(1, Math.min(3, Number(maxAttempts) || 2)),
    phase: "Waiting for the independent local worker", attempts: [], events: [],
    parentSkillId: state.activeSkillId, adoptedSkillId: null,
    mode: "live-model-and-browser", heldoutExposedToGenerator: false,
  };
  await persist(run);
  return run;
  } finally { creating = false; }
}
export async function stopLabRun(runId) {
  const run = await getLabRun(runId);
  if (!run) throw Error("Skill-lab run not found");
  if (terminal.has(run.status)) return run;
  await save(path.join(labRunDir(runId), "cancel.json"), { at: new Date().toISOString() });
  if (run.status === "queued") {
    run.status = "stopped";
    await record(run, "Cancelled before execution");
  }
  return run;
}
export async function nextLabJob() {
  const state = await labState();
  return state.runs.filter((r) => r.status === "queued").at(-1) || null;
}
export async function recoverLabJobs() {
  const state = await labState();
  const registry = await json(path.join(LAB, "registry.json"), {});
  for (const run of state.runs.filter((r) => r.status === "running")) {
    if (registry.runId === run.id) {
      const skill = await getSkill(registry.activeSkillId);
      if (skill) {
        skill.status = "adopted";
        await save(path.join(LAB, "skills", skill.id + ".json"), skill);
      }
      const attempt = run.attempts.find((a) => a.skillId === registry.activeSkillId);
      if (attempt) attempt.status = "adopted";
      run.status = "completed";
      run.adoptedSkillId = registry.activeSkillId;
      await record(run, "Recovered the committed skill adoption receipt", "recovery");
    } else {
      run.status = "failed";
      run.error = "Worker interrupted. Evidence was preserved and the previously active skill was retained. Start a new run.";
      await record(run, run.error, "recovery");
    }
  }
}
export async function sealCohort() {
  const files = {};
  for (const fixture of listFixtures()) {
    const folder = fixture.directory || fixture.root;
    async function walk(relative = "") {
      for (const entry of (await fs.readdir(path.join(folder, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (["node_modules", "dist", ".git", ".frameshift-build"].includes(entry.name)) continue;
        const name = path.join(relative, entry.name);
        if (entry.isSymbolicLink()) throw Error("Evaluation fixtures must not contain source symlinks");
        if (entry.isDirectory()) await walk(name);
        else files[fixture.id + "/" + name] = digest(await fs.readFile(path.join(folder, name)));
      }
    }
    await walk();
    files[fixture.id + "/evaluation-policy"] = digest(JSON.stringify(fixture.config));
  }
  for (const name of ["server/skills/service.mjs", "server/skills/generator.mjs", "server/skills/evaluate.mjs", "server/skills/runtime.mjs", "server/skills/execute.mjs", "server/benchmark.mjs", "server/core.mjs", "server/isolation.mjs", "server/integration.mjs", "sdk/vite.mjs", "sdk/runtime.mjs", "server/instrument-build.mjs"])
    files[name] = digest(await fs.readFile(path.join(ROOT, name)));
  return { hash: digest(JSON.stringify(files)), files };
}
function trainingFeedback(result) {
  // Deliberately enumerate training-only fields. No held-out result enters generation.
  return {
    split: "training", status: result.status, reason: result.reason,
    metrics: { baseline: result.baseline, candidate: result.candidate },
    guards: result.guards,
  };
}
function attachEvidence(run, result) {
  if (!result.evidenceDir) return result;
  const relative = path.relative(labRunDir(run.id), result.evidenceDir);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw Error("Evaluation evidence escaped its run");
  const url = (file) => "/api/lab/runs/" + run.id + "/artifact?path=" + encodeURIComponent(path.join(relative, file));
  return { ...result, referenceImageUrl: url("reference-0.png"), candidateImageUrl: url("candidate-0.png") };
}
export async function processLabJob(run) {
  const controller = new AbortController();
  activeController = controller;
  const cancelFile = path.join(labRunDir(run.id), "cancel.json");
  const timer = setInterval(async () => {
    if (await fs.stat(cancelFile).catch(() => null)) controller.abort();
  }, 350);
  timer.unref();
  const signal = controller.signal;
  try {
    run.status = "running";
    run.startedAt = new Date().toISOString();
    run.workerPid = process.pid;
    if (await fs.stat(cancelFile).catch(() => null)) controller.abort();
    signal.throwIfAborted();
    const cohort = await sealCohort();
    run.cohortHash = cohort.hash;
    await save(path.join(labRunDir(run.id), "cohort.json"), cohort);
    const fixtures = listFixtures();
    const training = fixtures.find((f) => f.id === run.trainingFixtureId && f.split === "training");
    if (!training) throw Error("Training fixture is unavailable");
    const heldout = fixtures.filter((f) => f.split === "heldout");
    const trainingFiles = {};
    for (const name of training.files)
      trainingFiles[name] = await fs.readFile(await safeFile(training.directory || training.root, name), "utf8");
    trainingFiles["training-cases/geometry.js"] = trainingGeometryVariant(trainingFiles[training.files[0]]);
    trainingFiles["training-cases/hierarchy.js"] = trainingHierarchyVariant(trainingFiles[training.files[0]]);
    let parent = run.parentSkillId ? await getSkill(run.parentSkillId) : null;
    const feedback = [];
    run.trainingMemoryFrom = [];
    const previousRuns = (await labState()).runs.filter((r) => r.id !== run.id && r.trainingFixtureId === training.id);
    for (const previous of previousRuns.slice(0, 3).reverse()) {
      const previousCohort = await json(path.join(labRunDir(previous.id), "cohort.json"), null);
      const sameTraining = previousCohort && Object.entries(cohort.files)
        .filter(([name]) => name.startsWith(training.id + "/"))
        .every(([name, hash]) => previousCohort.files[name] === hash);
      if (!sameTraining) continue;
      for (const attempt of previous.attempts.filter((a) => a.training)) {
        feedback.push(trainingFeedback(attempt.training));
        if (!run.parentSkillId) parent = await getSkill(attempt.skillId);
        run.trainingMemoryFrom.push({ runId: previous.id, skillId: attempt.skillId, split: "training" });
      }
    }
    for (let index = 1; index <= run.maxAttempts; index++) {
      signal.throwIfAborted();
      if (await fs.stat(cancelFile).catch(() => null)) { controller.abort(); signal.throwIfAborted(); }
      await record(run, `Attempt ${index}: learning an executable transformer from the training project only`, "generation");
      const context = trainingContext({ trainingFiles, feedback, parentSkill: parent });
      await save(path.join(labRunDir(run.id), "attempt-" + index, "generation-context.json"), context);
      const proposed = await generateSkill({ trainingFiles, feedback, parentSkill: parent, signal,
        onEvent: (event) => record(run, typeof event === "string" ? event : event.message || "Generating a reusable skill", "model") });
      const skill = { ...proposed, id: id(), version: ((await labState()).skills.length + 1), parentId: parent?.id || run.parentSkillId,
        createdAt: new Date().toISOString(), runId: run.id, status: "candidate",
        codeHash: digest(proposed.code), trainingFixtureId: training.id, generationAttempt: index };
      await save(path.join(LAB, "skills", skill.id + ".json"), skill);
      const attempt = { id: "attempt-" + index, skillId: skill.id, name: skill.name, evaluations: [], status: "training" };
      attempt.generationContextHash = digest(JSON.stringify(context));
      run.attempts.push(attempt);
      await record(run, `Attempt ${index}: testing the skill on its training application`, "training");
      const workspace = path.join(labRunDir(run.id), attempt.id);
      attempt.training = attachEvidence(run, await evaluateSkill({ skill, fixtureId: training.id,
        workspace: path.join(workspace, "training"), signal,
        onEvent: (event) => record(run, typeof event === "string" ? event : event.message, "training") }));
      if (attempt.training.status === "passed") {
        await record(run, "Checking geometry compatibility on a stress case derived from training source only", "training");
        attempt.trainingBase = attempt.training;
        const stress = attachEvidence(run, await evaluateSkill({ skill, fixtureId: training.id, trainingVariant: true,
          workspace: path.join(workspace, "training-geometry"), signal,
          onEvent: (event) => record(run, typeof event === "string" ? event : event.message, "training") }));
        attempt.trainingStress = stress;
        if (stress.status !== "passed") attempt.training = stress;
      }
      if (attempt.training.status === "passed") {
        await record(run, "Checking nested moving parents on a stress case derived from training source only", "training");
        const stress = attachEvidence(run, await evaluateSkill({ skill, fixtureId: training.id, trainingVariant: "hierarchy",
          workspace: path.join(workspace, "training-hierarchy"), signal,
          onEvent: (event) => record(run, typeof event === "string" ? event : event.message, "training") }));
        attempt.trainingHierarchy = stress;
        if (stress.status !== "passed") attempt.training = stress;
      }
      await persist(run);
      if (attempt.training.status !== "passed") {
        skill.status = "training-rejected";
        attempt.status = "training-rejected";
        attempt.decision = { adopt: false, reason: "Training did not pass; no held-out evaluation or promotion occurred." };
        await save(path.join(LAB, "skills", skill.id + ".json"), skill);
        feedback.push(trainingFeedback(attempt.training));
        parent = skill;
        await record(run, `Attempt ${index}: training failed; preserving the failure for the next skill revision`, "rejection");
        continue;
      }
      // Freeze candidate bytes before exposing them to evaluation. No model calls below.
      attempt.status = "heldout";
      const frozenCodeHash = digest(skill.code);
      await record(run, "Skill frozen. Evaluating unseen application source without another model call", "heldout");
      for (const fixture of heldout) {
        const result = await evaluateSkill({ skill, fixtureId: fixture.id,
          workspace: path.join(workspace, fixture.id), signal,
          onEvent: (event) => record(run, typeof event === "string" ? event : event.message, "heldout") });
        attempt.evaluations.push(attachEvidence(run, result));
        await persist(run);
      }
      const currentResults = [];
      if (run.parentSkillId) {
        const activeSkill = await getSkill(run.parentSkillId);
        for (const fixture of heldout)
          currentResults.push(await evaluateSkill({ skill: activeSkill, fixtureId: fixture.id,
            workspace: path.join(workspace, "previous", fixture.id), signal,
            onEvent: (event) => record(run, typeof event === "string" ? event : event.message, "comparison") }));
      } else {
        for (const result of attempt.evaluations)
          currentResults.push({ ...result, status: "baseline", candidate: result.baseline });
      }
      attempt.currentResults = currentResults;
      const unchanged = (await sealCohort()).hash === cohort.hash && digest(skill.code) === frozenCodeHash;
      const outcome = adoptionDecision({ candidateResults: attempt.evaluations, currentResults,
        requiredFixtureIds: heldout.map((f) => f.id) });
      attempt.decision = unchanged ? outcome : { adopt: false, reason: "The frozen evaluation policy, cohort or candidate changed. Retaining the previous skill." };
      signal.throwIfAborted();
      if (await fs.stat(cancelFile).catch(() => null)) throw Error("Skill discovery cancelled before adoption");
      skill.status = attempt.decision.adopt ? "evaluation-passed" : "evaluation-rejected";
      attempt.status = skill.status;
      skill.decision = attempt.decision;
      skill.cohortHash = cohort.hash;
      await save(path.join(LAB, "skills", skill.id + ".json"), skill);
      if (attempt.decision.adopt) {
        const registry = await json(path.join(LAB, "registry.json"), { activeSkillId: null });
        if (registry.activeSkillId !== run.parentSkillId)
          throw Error("Active skill changed during evaluation; refusing to overwrite it");
        await save(path.join(LAB, "registry.json"), {
          activeSkillId: skill.id, previousSkillId: run.parentSkillId, runId: run.id,
          cohortHash: cohort.hash, adoptedAt: new Date().toISOString(), decision: attempt.decision,
        });
        skill.status = "adopted";
        attempt.status = "adopted";
        await save(path.join(LAB, "skills", skill.id + ".json"), skill);
        run.adoptedSkillId = skill.id;
      }
      await record(run, attempt.decision.reason, attempt.decision.adopt ? "adoption" : "rollback");
      // Never tune on held-out outcomes: end this run after its single held-out gate.
      break;
    }
    run.status = "completed";
    await record(run, run.adoptedSkillId ? "A new executable skill was adopted after held-out evaluation." : "No skill was adopted. The previous active version is unchanged.", "complete");
  } catch (error) {
    run.status = signal.aborted ? "stopped" : "failed";
    run.error = cleanError(error);
    await record(run, run.error, run.status);
  } finally {
    clearInterval(timer);
    activeController = null;
    run.completedAt = new Date().toISOString();
    await persist(run);
  }
}
