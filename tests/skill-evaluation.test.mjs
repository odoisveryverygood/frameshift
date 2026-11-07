import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { listFixtures, adoptionDecision, evaluateSkill, trainingGeometryVariant, trainingHierarchyVariant } from "../server/skills/evaluate.mjs";
import * as THREE from "three";
import path from "node:path";

test("training hierarchy stress keeps semantic meshes under genuinely moving ancestors", async () => {
  const fixture = listFixtures().find((f) => f.split === "training");
  const source = trainingHierarchyVariant(await fs.readFile(path.join(fixture.directory, fixture.files[0]), "utf8"));
  const scene = new THREE.Scene();
  const world = new Function("THREE", "scene", source.replace(/export\s+function/g, "function") + "\nreturn createWorld(THREE, scene);")(THREE, scene);
  const meshes = []; scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  assert.equal(meshes.length, 196);
  assert.equal(new Set(meshes.map((m) => m.userData.semanticId)).size, 196);
  assert.notEqual(meshes[0].parent, scene);
  world.update(0.2); const a = meshes[0].parent.parent.rotation.y;
  world.update(2.1); const b = meshes[0].parent.parent.rotation.y;
  assert.notEqual(a, b);
});

test("training geometry stress preserves identities and animation while varying actual vertex data", async () => {
  const fixture = listFixtures().find((f) => f.split === "training");
  const source = await fs.readFile(path.join(fixture.directory, fixture.files[0]), "utf8");
  const build = (text) => new Function("THREE", "scene", text.replace(/export\s+function/g, "function") + "\nreturn createWorld(THREE, scene);");
  const baseline = new THREE.Scene(), varied = new THREE.Scene();
  const originalWorld = build(source)(THREE, baseline);
  const stressWorld = build(trainingGeometryVariant(source))(THREE, varied);
  originalWorld.update(1.7); stressWorld.update(1.7);
  assert.equal(baseline.children.length, varied.children.length);
  for (let index = 0; index < baseline.children.length; index++) {
    assert.equal(varied.children[index].name, baseline.children[index].name);
    assert.deepEqual(varied.children[index].position.toArray(), baseline.children[index].position.toArray());
    assert.deepEqual(varied.children[index].rotation.toArray(), baseline.children[index].rotation.toArray());
  }
  assert.notDeepEqual(Array.from(baseline.children[0].geometry.attributes.position.array), Array.from(varied.children[0].geometry.attributes.position.array));
  assert.deepEqual(baseline.children[0].geometry.parameters, varied.children[0].geometry.parameters);
});

const sample = (calls) => ({ calls, submitP95: 1, frameP95: 17, repeatMetrics: [0.9, 1, 1.1] });
function outcomes() {
  const ids = ["heldout-assembly", "heldout-carts"];
  return {
    candidateResults: ids.map((fixtureId) => ({ fixtureId, split: "heldout", status: "passed", baseline: sample(200), candidate: sample(10), guards: { pass: true } })),
    currentResults: ids.map((fixtureId) => ({ fixtureId, split: "heldout", status: "baseline", baseline: sample(200), candidate: sample(200), guards: { pass: true, referenceOnly: true } })),
  };
}
test("fixed authored cohort separates one learning project from two distinct held-out projects", async () => {
  const fixtures = listFixtures();
  assert.equal(fixtures.filter((entry) => entry.split === "training").length, 1);
  assert.equal(fixtures.filter((entry) => entry.split === "heldout").length, 2);
  const sources = await Promise.all(fixtures.map((entry) => fs.readFile(entry.directory + "/src/world.js", "utf8")));
  assert.equal(new Set(sources).size, 3);
  assert.match(sources[0], /BoxGeometry/);
  assert.match(sources[1], /CylinderGeometry/);
  assert.match(sources[1], /module\.add\(part\)/);
  assert.match(sources[2], /lane\.add\(body, cargo\)/);
  fixtures[0].config.checkpoints.pop();
  assert.equal(listFixtures()[0].config.checkpoints.length, 8);
});
test("adoption requires all held-out projects and real repeated evidence, never training-only success", () => {
  const valid = outcomes();
  assert.equal(adoptionDecision(valid).adopt, true);
  assert.equal(adoptionDecision({ ...valid, candidateResults: [valid.candidateResults[0]] }).adopt, false);
  assert.equal(adoptionDecision({ ...valid, candidateResults: [{ ...valid.candidateResults[0], fixtureId: "training-cells", split: "training" }] }).adopt, false);
  assert.equal(adoptionDecision({ ...valid, requiredFixtureIds: ["heldout-assembly"] }).adopt, false);
  assert.equal(adoptionDecision({ ...valid, candidateResults: [valid.candidateResults[0], valid.candidateResults[0]] }).adopt, false);
  valid.candidateResults[1].candidate.repeatMetrics = [];
  assert.equal(adoptionDecision(valid).adopt, false);
});
test("failure, inconclusive, false guard, or reference-only candidate evidence blocks adoption", () => {
  for (const change of [
    (row) => { row.status = "failed"; },
    (row) => { row.status = "inconclusive"; },
    (row) => { row.guards.pass = false; },
    (row) => { row.guards.referenceOnly = true; },
  ]) {
    const data = outcomes();
    change(data.candidateResults[1]);
    assert.equal(adoptionDecision(data).adopt, false);
  }
});
test("a new skill must beat its incumbent rather than merely beat unoptimized code", () => {
  const data = outcomes();
  data.currentResults = data.currentResults.map((row) => ({ ...row, status: "passed", candidate: sample(8), guards: { pass: true } }));
  assert.equal(adoptionDecision(data).adopt, false);
  data.currentResults = data.currentResults.map((row) => ({ ...row, candidate: sample(10) }));
  assert.equal(adoptionDecision(data).adopt, false);
  data.candidateResults.forEach((row) => { row.candidate = sample(6); });
  assert.equal(adoptionDecision(data).adopt, true);
  data.candidateResults[1].candidate.frameP95 = 30;
  assert.equal(adoptionDecision(data).adopt, false);
});
test("missing incumbent measurements and unknown fixture IDs fail closed", async () => {
  const data = outcomes();
  data.currentResults[0].candidate.frameP95 = undefined;
  assert.equal(adoptionDecision(data).adopt, false);
  await assert.rejects(() => evaluateSkill({ fixtureId: "user-supplied-hidden-set", workspace: "/tmp/unused" }), /Unknown fixed-cohort fixture/);
});
