/** Fixed authored cohort, disjoint from skill generation. No model calls here. */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT, copyProject, dependencies, command, save, decision } from "../core.mjs";
import { capture, verify, measure, measurePair, withPage } from "../benchmark.mjs";
import { applySkill } from "./runtime.mjs";

const cohort = [
  { id: "training-cells", name: "Orbit cells", split: "training", description: "196 individually animated opaque boxes with two colors and actual click selection." },
  { id: "heldout-assembly", name: "Assembly viewer", split: "heldout", description: "Repeated cylindrical parts with multiple dimensions inside nested rotating subassemblies." },
  { id: "heldout-carts", name: "Warehouse lanes", split: "heldout", description: "240 cart and cargo meshes with independent local motion inside translated lanes." },
];
const fixedConfig = {
  autoInstrument: true,
  outputDir: "dist",
  editableFiles: ["src/world.js"],
  metric: "drawCalls",
  minImprovement: 0.08,
  maxVisualDifference: 0.01,
  samples: 40,
  repeats: 3,
  checkpoints: [
    { time: 0.17, view: 0 }, { time: 0.71, view: 1 },
    { time: 1.39, view: 2 }, { time: 2.1, view: 0 },
    { time: 3.14, view: 1 }, { time: 4.27, view: 2 },
    { time: 5.33, view: 0 }, { time: 6.4, view: 1 },
  ],
};
export function listFixtures() {
  return cohort.map((fixture) => ({
    ...fixture,
    directory: path.join(ROOT, "lab", "fixtures", fixture.id),
    files: ["src/world.js"],
    config: structuredClone(fixedConfig),
  }));
}
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
async function hashes(directory, files) {
  return Object.fromEntries(await Promise.all(files.map(async (file) => [file, sha(await fs.readFile(path.join(directory, file)))])));
}
async function build(directory, config, signal, onEvent) {
  await dependencies(directory, ROOT);
  const settings = path.join(directory, ".frameshift-build", "lab-settings.json");
  await save(settings, config);
  await command([process.execPath, path.join(ROOT, "server", "instrument-build.mjs"), directory, settings], directory, {
    isolate: true, signal, timeout: 120000,
    onLog: (line) => { if (line.trim()) onEvent(line.trim().slice(-300)); },
  });
  return path.join(directory, "dist");
}
async function selectionPlan(directory, signal) {
  return withPage(directory, signal, async (page) => page.evaluate(() => {
    window.__frameshift.step(0.35, 0);
    // Select the first visible non-edge target in a fixed deterministic scan.
    for (const y of [0, 0.15, -0.15, 0.3, -0.3, 0.45, -0.45]) {
      for (const x of [0, 0.15, -0.15, 0.3, -0.3, 0.45, -0.45, 0.6, -0.6]) {
        const id = window.__frameshift.pick(x, y);
        if (id) return { id, at: 0.35, x: (x + 1) / 2, y: (1 - y) / 2 };
      }
    }
    throw Error("Reference application has no selectable object in the fixed probe grid");
  }));
}
function selectedText(captureResult) {
  return captureResult.interaction?.state?.interactionState?.dom?.find((entry) => entry.label === "selection")?.text;
}

export function trainingGeometryVariant(source) {
  if (!/export\s+function\s+createWorld\s*\(/.test(source)) throw Error("Training factory contract missing");
  return source.replace(/export\s+function\s+createWorld\s*\(/, "function __earlTrainingBase(") + `
export function createWorld(THREE, scene) {
  const world = __earlTrainingBase(THREE, scene);
  const meshes = [];
  scene.traverse(object => { if (object.isMesh) meshes.push(object); });
  for (let index = 0; index < meshes.length; index++) {
    meshes[index].geometry.scale([0.72, 1, 1.28][index % 3], 1, 1);
  }
  return world;
}
`;
}
export function trainingHierarchyVariant(source) {
  if (!/export\s+function\s+createWorld\s*\(/.test(source)) throw Error("Training factory contract missing");
  return source.replace(/export\s+function\s+createWorld\s*\(/, "function __earlTrainingBase(") + `
export function createWorld(THREE, scene) {
  const outer = new THREE.Group();
  outer.position.set(0.3, 0.2, -0.25);
  const inner = new THREE.Group();
  inner.position.set(-0.1, 0.15, 0.2);
  outer.add(inner);
  scene.add(outer);
  const world = __earlTrainingBase(THREE, inner);
  const update = world.update;
  world.update = function(time) {
    const result = update.call(this, time);
    outer.rotation.y = Math.sin(time * 0.2) * 0.09;
    inner.rotation.x = Math.cos(time * 0.4) * 0.05;
    return result;
  };
  return world;
}
`;
}
export async function evaluateSkill({ skill = null, fixtureId, workspace, signal, onEvent = () => {}, trainingVariant = false } = {}) {
  const fixture = listFixtures().find((entry) => entry.id === fixtureId);
  if (!fixture) throw Error("Unknown fixed-cohort fixture");
  if (trainingVariant && fixture.split !== "training") throw Error("Training variations cannot modify a held-out project");
  if (typeof workspace !== "string" || !path.isAbsolute(workspace)) throw Error("An absolute evaluation workspace is required");
  await fs.mkdir(workspace, { recursive: true });
  const referenceDir = path.join(workspace, "reference");
  const candidateDir = path.join(workspace, "candidate");
  for (const directory of [referenceDir, candidateDir])
    if (await fs.stat(directory).catch(() => null)) throw Error("Evaluation workspace is not fresh");
  const evidenceDir = path.join(workspace, "evidence");
  const result = {
    fixtureId, name: fixture.name, split: fixture.split,
    status: "failed", reason: "Evaluation did not complete",
    startedAt: new Date().toISOString(), evidenceDir,
    evidenceMode: "local browser; fixed authored cohort",
    changedFiles: [],
  };
  try {
    signal?.throwIfAborted();
    await onEvent(`Preparing ${fixture.name} from its immutable source`);
    await copyProject(fixture.directory, referenceDir);
    if (trainingVariant) {
      const file = path.join(referenceDir, fixture.files[0]);
      const vary = trainingVariant === "hierarchy" ? trainingHierarchyVariant : trainingGeometryVariant;
      await fs.writeFile(file, vary(await fs.readFile(file, "utf8")));
      result.trainingVariant = trainingVariant === "hierarchy" ? "moving nested parents" : "mutated geometry compatibility";
    }
    const config = structuredClone(fixture.config);
    const referenceOutput = await build(referenceDir, config, signal, onEvent);
    const target = await selectionPlan(referenceOutput, signal);
    config.scenario = { name: "Reference-selected object identity", events: [{ type: "click", at: target.at, x: target.x, y: target.y }] };
    await save(path.join(evidenceDir, "evaluation-policy.json"), { ...config, selectionTarget: target });
    await onEvent(`Checking reference selection and capturing eight viewpoints for ${fixture.name}`);
    const referenceCapture = await capture(referenceOutput, evidenceDir, "reference", signal, config);
    if (selectedText(referenceCapture) !== target.id)
      throw Error(`Reference click did not select the expected object: expected ${target.id}, observed ${selectedText(referenceCapture)}`);
    await save(path.join(evidenceDir, "reference-states.json"), referenceCapture);
    result.sourceHashes = { reference: await hashes(referenceDir, fixture.files) };
    if (!skill) {
      await onEvent(`Measuring the unoptimized baseline for ${fixture.name}`);
      const measurement = await measure(referenceOutput, config, signal);
      await save(path.join(evidenceDir, "reference-metrics.json"), measurement);
      Object.assign(result, {
        status: "baseline", reason: "No skill applied; actual reference measurement only",
        baseline: measurement.summary, candidate: measurement.summary,
        guards: { pass: true, referenceOnly: true, selection: { expected: target.id, reference: selectedText(referenceCapture) } },
      });
    } else {
      await copyProject(referenceDir, candidateDir);
      await dependencies(candidateDir, ROOT);
      await onEvent(`Applying the frozen executable skill to ${fixture.name}; no model access`);
      const applied = await applySkill({ skill, workspace: candidateDir, files: fixture.files, signal });
      result.changedFiles = applied.changedFiles;
      result.notes = applied.notes;
      result.sourceHashes.candidate = await hashes(candidateDir, fixture.files);
      if (!applied.changedFiles.length) {
        result.status = "inconclusive";
        result.reason = "Skill made no executable candidate change on this project";
      } else {
        const candidateOutput = await build(candidateDir, config, signal, onEvent);
        const candidateCapture = await capture(candidateOutput, evidenceDir, "candidate", signal, config, referenceCapture);
        await save(path.join(evidenceDir, "candidate-states.json"), candidateCapture);
        const guards = await verify(referenceCapture, candidateCapture, evidenceDir, config);
        guards.selection = { expected: target.id, reference: selectedText(referenceCapture), candidate: selectedText(candidateCapture) };
        guards.pass = guards.pass && guards.selection.reference === target.id && guards.selection.candidate === target.id;
        result.guards = guards;
        await save(path.join(evidenceDir, "guards.json"), guards);
        if (!guards.pass) {
          result.reason = "Appearance, transforms, object identity, or actual click behavior changed";
        } else {
          await onEvent(`Running alternating reference/candidate measurements for ${fixture.name}`);
          const paired = await measurePair(referenceOutput, candidateOutput, config, signal);
          result.baseline = paired.reference.summary;
          result.candidate = paired.candidate.summary;
          await save(path.join(evidenceDir, "reference-metrics.json"), paired.reference);
          await save(path.join(evidenceDir, "candidate-metrics.json"), paired.candidate);
          await save(path.join(evidenceDir, "measurement-order.json"), paired.order);
          const verdict = decision(result.baseline, result.candidate, guards, config);
          result.status = verdict.status === "accepted" ? "passed" : verdict.status === "rejected" ? "failed" : "inconclusive";
          result.reason = verdict.reason;
          result.improvement = verdict.improvement;
          result.threshold = verdict.threshold;
        }
      }
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    result.status = "failed";
    result.reason = String(error.message).replace(/sk-[\w-]+/g, "[redacted]").slice(0, 4000);
  }
  result.completedAt = new Date().toISOString();
  await save(path.join(evidenceDir, "evaluation.json"), result);
  return result;
}

/** Recompute adoption from frozen held-out outcomes, never a model's judgment. */
export function adoptionDecision({ candidateResults = [], currentResults = [], requiredFixtureIds } = {}) {
  const required = cohort.filter((entry) => entry.split === "heldout").map((entry) => entry.id);
  const rollback = (reason) => ({ adopt: false, status: "rolled-back", reason });
  if (requiredFixtureIds && JSON.stringify([...requiredFixtureIds].sort()) !== JSON.stringify([...required].sort()))
    return rollback("Adoption requires the complete fixed held-out cohort");
  const candidates = candidateResults.filter((row) => required.includes(row.fixtureId));
  const current = currentResults.filter((row) => required.includes(row.fixtureId));
  if (candidates.length !== required.length || new Set(candidates.map((row) => row.fixtureId)).size !== required.length)
    return rollback("Every held-out project needs exactly one completed candidate evaluation");
  if (current.length !== required.length || new Set(current.map((row) => row.fixtureId)).size !== required.length)
    return rollback("Every held-out project needs a comparable current-skill or unoptimized baseline");
  let before = 0, after = 0;
  for (const id of required) {
    const row = candidates.find((entry) => entry.fixtureId === id);
    const old = current.find((entry) => entry.fixtureId === id);
    if (row.split !== "heldout" || row.status !== "passed" || row.guards?.referenceOnly ||
        decision(row.baseline, row.candidate, row.guards, fixedConfig).status !== "accepted")
      return rollback(`Candidate did not independently pass the fixed correctness and performance gates on ${id}`);
    if (old.split !== "heldout" || !["baseline", "passed"].includes(old.status) ||
        decision(old.candidate, old.candidate, { pass: true }, fixedConfig).status === "rejected")
      return rollback(`Current skill has no valid comparison measurement on ${id}`);
    if (old.status === "passed" && decision(old.baseline, old.candidate, old.guards, fixedConfig).status !== "accepted")
      return rollback(`Current skill evaluation is inconsistent on ${id}`);
    if (row.candidate.calls > old.candidate.calls)
      return rollback(`Candidate increased draw calls relative to the current skill on ${id}`);
    const cpuRegression = row.candidate.submitP95 > old.candidate.submitP95 * 1.15 && row.candidate.submitP95 - old.candidate.submitP95 > 0.5;
    if (cpuRegression || row.candidate.frameP95 > old.candidate.frameP95 * 1.15)
      return rollback(`Candidate regressed CPU submission or frame pacing relative to the current skill on ${id}`);
    before += old.candidate.calls;
    after += row.candidate.calls;
  }
  const improvement = 1 - after / before;
  if (!(improvement > fixedConfig.minImprovement))
    return rollback("Candidate did not improve aggregate held-out draw calls beyond the fixed 8% threshold");
  return {
    adopt: true, status: "adopted", reason: "Every held-out project passed independently, no project regressed, and aggregate draw calls improved beyond 8%",
    improvement, beforeCalls: before, afterCalls: after, heldoutProjects: required.length,
  };
}
