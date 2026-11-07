import test from "node:test";
import assert from "node:assert/strict";
import { assessPatchRisks, verificationConfigForRisks, parseRiskAnswers, baseCheckpoints, riskNames } from "../server/subq.mjs";
const body = (noul = 0) => ({ model: "subq-snap-1.1", answers: Object.fromEntries(riskNames.map(n => [n, { type: "noul", noul }])) });
test("risk selection adds fixed probes and cannot weaken baseline policy", () => {
  const config = { maxVisualDifference: 0.001, scenario: { events: [{ type: "click", x: 0.5, y: 0.5 }] } };
  const low = verificationConfigForRisks(config, { probabilities: parseRiskAnswers(body()) });
  const high = verificationConfigForRisks(config, { probabilities: parseRiskAnswers(body(1)), threshold: 1, selectedRisks: [] });
  assert.deepEqual(low.checkpoints, baseCheckpoints);
  assert.equal(high.checkpoints.length, 16);
  assert.deepEqual(high.checkpoints.slice(0, 8), baseCheckpoints);
  assert.equal(high.maxVisualDifference, config.maxVisualDifference);
  assert.deepEqual(high.scenario, config.scenario);
  assert.deepEqual(high.subqVerification.selectedRisks, riskNames);
  assert.equal(config.checkpoints, undefined);
});
test("decision parser rejects missing, non-finite, out-of-range and wrong model answers", () => {
  for (const value of [NaN, Infinity, -0.1, 1.1, "1", null]) assert.throws(() => parseRiskAnswers(body(value)));
  assert.throws(() => parseRiskAnswers({ model: "other", answers: body().answers }));
  assert.throws(() => parseRiskAnswers({ model: "subq-snap-1.1", answers: {} }));
});
test("adapter sends named risk gates and handles denied access without a substitute", async () => {
  const input = { sources: { "scene.js": "new Mesh()" }, patch: "replace Mesh with InstancedMesh", contract: { preserveSelection: true } };
  let calls = 0;
  const result = await assessPatchRisks(input, { apiKey: "fixture", fetchImpl: async (url, request) => {
    calls++;
    assert.equal(url, "https://api.subq.ai/v1/systemone");
    const payload = JSON.parse(request.body);
    assert.deepEqual(Object.keys(payload.questions), riskNames);
    assert.equal(payload.model, "subq-snap-1.1");
    return { ok: true, json: async () => body(0.7) };
  } });
  assert.equal(calls, 1);
  assert.equal(result.inputSha256.length, 64);
  assert.deepEqual(result.selectedRisks, riskNames);
  assert.equal(JSON.stringify(result).includes("fixture"), false);
  await assert.rejects(assessPatchRisks(input, { apiKey: "fixture", fetchImpl: async () => ({ ok: false, status: 403 }) }), /model access denied.*no fallback/);
  await assert.rejects(assessPatchRisks(input, { apiKey: "" }), /SUBQ_API_KEY/);
});
