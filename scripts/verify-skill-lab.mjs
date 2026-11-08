/** Inspect a real completed run. This never fabricates a skill or starts a model call. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ROOT, DATA } from "../server/core.mjs";
import { adoptionDecision, listFixtures, trainingGeometryVariant, trainingHierarchyVariant } from "../server/skills/evaluate.mjs";
import { sealCohort } from "../server/skills/service.mjs";

const origin = "http://127.0.0.1:" + (process.env.PORT || "4310");
const args = process.argv.slice(2);
const index = args.indexOf("--run");
const requested = index >= 0 ? args[index + 1] : null;
async function get(route) {
  const response = await fetch(origin + route);
  assert.equal(response.status, 200, "API unavailable: " + route);
  return response.json();
}
const state = await get("/api/lab");
const run = requested ? await get("/api/lab/runs/" + encodeURIComponent(requested)) :
  state.runs.find((r) => r.adoptedSkillId && r.status === "completed");
assert.ok(run, "No completed adopted run. Discover a skill in /lab first, or pass --run ID.");
assert.equal(run.status, "completed", run.error || run.phase);
assert.ok(run.adoptedSkillId, "This run did not adopt a skill; rejection is not a transfer success.");
assert.equal(run.heldoutExposedToGenerator, false);
const attempt = run.attempts.find((a) => a.skillId === run.adoptedSkillId);
assert.ok(attempt);
assert.equal(attempt.training.status, "passed");
assert.deepEqual(attempt.evaluations.map((e) => e.fixtureId).sort(), ["heldout-assembly", "heldout-carts"]);
for (const result of [attempt.training, ...attempt.evaluations]) {
  assert.equal(result.status, "passed", result.reason);
  assert.equal(result.guards.pass, true);
  assert.equal(result.guards.checks.length, 8);
  assert.equal(result.guards.selection.reference, result.guards.selection.expected);
  assert.equal(result.guards.selection.candidate, result.guards.selection.expected);
  assert.ok(result.candidate.calls < result.baseline.calls);
  assert.ok(result.sourceHashes?.candidate);
  for (const url of [result.referenceImageUrl, result.candidateImageUrl]) {
    assert.ok(url?.startsWith("/api/lab/"));
    const response = await fetch(origin + url);
    assert.equal(response.status, 200, "Missing real capture");
    assert.match(response.headers.get("content-type"), /image\/png/);
  }
}
assert.equal(adoptionDecision({ candidateResults: attempt.evaluations, currentResults: attempt.currentResults }).adopt, true);
const skill = await get("/api/lab/skills/" + run.adoptedSkillId);
assert.equal(crypto.createHash("sha256").update(skill.code).digest("hex"), skill.codeHash);
assert.equal(skill.cohortHash, run.cohortHash);
assert.equal((await sealCohort()).hash, run.cohortHash, "Current evaluation sources differ from this run's sealed cohort");
assert.ok(skill.model && skill.usage);
const context = JSON.parse(await fs.readFile(path.join(DATA, "skill-lab", "runs", run.id, attempt.id, "generation-context.json"), "utf8"));
assert.equal(crypto.createHash("sha256").update(JSON.stringify(context)).digest("hex"), attempt.generationContextHash);
assert.equal(context.split, "training");
assert.ok(context.feedback.every((f) => f.split === "training"));
const fixture = listFixtures().find((f) => f.id === run.trainingFixtureId && f.split === "training");
const expectedSource = Object.fromEntries(await Promise.all(fixture.files.map(async (name) => [name, await fs.readFile(path.join(fixture.directory, name), "utf8")])));
expectedSource["training-cases/geometry.js"] = trainingGeometryVariant(expectedSource[fixture.files[0]]);
expectedSource["training-cases/hierarchy.js"] = trainingHierarchyVariant(expectedSource[fixture.files[0]]);
assert.deepEqual(context.trainingFiles, expectedSource);
assert.equal(attempt.trainingStress?.status, "passed", "The training geometry stress case did not pass");
assert.equal(attempt.trainingHierarchy?.status, "passed", "The training hierarchy stress case did not pass");
const blocked = await fetch(origin + "/api/lab/runs", {
  method: "POST", headers: { "Content-Type": "application/json", Origin: "https://untrusted.example" }, body: "{}",
});
assert.equal(blocked.status, 403);
const heldout = await fetch(origin + "/api/lab/runs", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ trainingFixtureId: "heldout-assembly" }),
});
assert.equal(heldout.status, 400);
const traversal = await fetch(origin + "/api/lab/runs/" + run.id + "/artifact?path=../registry.json");
assert.notEqual(traversal.status, 200);
const evidence = {
  at: new Date().toISOString(), mode: "live-model-and-local-browser",
  runId: run.id, skillId: skill.id, model: skill.model, usage: skill.usage,
  cohortHash: run.cohortHash, codeHash: skill.codeHash, trainingMemoryFrom: run.trainingMemoryFrom,
  checks: ["Completed adopted run", "One training + two held-out applications", "Training geometry stress case", "Training hierarchy stress case", "Eight checkpoints and real click behavior per application", "Paired repeated measurements", "Real PNG capture delivery", "Deterministic adoption recomputation", "Executable skill hash", "Saved training-only generation context", "Cross-origin write denial", "Held-out training denial", "Artifact traversal denial"],
  training: attempt.training, trainingStress: attempt.trainingStress, trainingHierarchy: attempt.trainingHierarchy, evaluations: attempt.evaluations, decision: attempt.decision,
  limitations: state.limitations,
};
await fs.mkdir(path.join(ROOT, "verification"), { recursive: true });
await fs.writeFile(path.join(ROOT, "verification", "skill-lab-live.json"), JSON.stringify(evidence, null, 2).replaceAll(ROOT, "<repository>"));
console.log("PASS", evidence.checks.length, "live Skill Lab checks", run.id);
console.log(JSON.stringify(evidence.evaluations.map((r) => ({ project: r.fixtureId, calls: [r.baseline.calls, r.candidate.calls], selection: r.guards.selection })), null, 2));
