import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sealVerificationPolicy, writeVerificationVerdict } from "../server/verifier.mjs";

async function evidence(t, guard = true) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "earl-verifier-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const ref = { submitP95: 10, frameP95: 17, repeatMetrics: [9.9, 10, 10.1], calls: 100 };
  const candidate = { ...ref, submitP95: 5, repeatMetrics: [4.9, 5, 5.1], calls: 10 };
  await fs.mkdir(path.join(dir, "reference"));
  await fs.mkdir(path.join(dir, "candidate"));
  await fs.writeFile(path.join(dir, "reference", "scene.js"), "renderMeshes()");
  await fs.writeFile(path.join(dir, "candidate", "scene.js"), "renderInstances()");
  await fs.writeFile(path.join(dir, "change.patch"), "-renderMeshes()\n+renderInstances()");
  for (const [name, value] of Object.entries({
    "reference-metrics.json": { summary: ref },
    "candidate-metrics.json": { summary: candidate },
    "guards.json": { pass: guard },
    "measurement-order.json": ["reference", "candidate", "candidate", "reference"],
  })) await fs.writeFile(path.join(dir, name), JSON.stringify(value));
  return dir;
}
test("verifier re-evaluates evidence and records reproducible policy and artifact hashes", async (t) => {
  const evidenceDir = await evidence(t);
  const config = { metric: "submitP95", editableFiles: ["scene.js"], minImprovement: 0.08, checkpoints: [{ time: 0, view: 0 }] };
  const seal = await sealVerificationPolicy(config, config.metric);
  const result = await writeVerificationVerdict({ seal, config, metric: config.metric, evidenceDir, referenceSourceDir: path.join(evidenceDir, "reference"), candidateSourceDir: path.join(evidenceDir, "candidate") });
  assert.equal(result.status, "accepted");
  const receipt = JSON.parse(await fs.readFile(path.join(evidenceDir, "verdict.json")));
  assert.equal(receipt.policyHash, seal.hash);
  assert.match(receipt.artifacts["guards.json"].sha256, /^[a-f0-9]{64}$/);
  assert.equal(receipt.coverage.checkpoints, 1);
  assert.equal(Object.keys(receipt.implementations).length, 6);
  assert.notEqual(receipt.sources.reference["scene.js"], receipt.sources.candidate["scene.js"]);
});
test("a faster candidate with failed behavior cannot be accepted", async (t) => {
  const evidenceDir = await evidence(t, false);
  const config = { metric: "submitP95", editableFiles: ["scene.js"] };
  const seal = await sealVerificationPolicy(config, config.metric);
  assert.equal((await writeVerificationVerdict({ seal, config, metric: config.metric, evidenceDir, referenceSourceDir: path.join(evidenceDir, "reference"), candidateSourceDir: path.join(evidenceDir, "candidate") })).status, "rejected");
});
test("changing policy after inspection blocks a verdict", async (t) => {
  const evidenceDir = await evidence(t);
  const config = { metric: "submitP95", minImprovement: 0.1 };
  const seal = await sealVerificationPolicy(config, config.metric);
  config.minImprovement = 0.001;
  await assert.rejects(() => writeVerificationVerdict({ seal, config, metric: config.metric, evidenceDir }), /policy or implementation changed/);
});
test("missing benchmark evidence fails closed", async (t) => {
  const evidenceDir = await evidence(t);
  const config = { metric: "submitP95" };
  const seal = await sealVerificationPolicy(config, config.metric);
  await fs.unlink(path.join(evidenceDir, "measurement-order.json"));
  await assert.rejects(() => writeVerificationVerdict({ seal, config, metric: config.metric, evidenceDir }), /ENOENT/);
});
