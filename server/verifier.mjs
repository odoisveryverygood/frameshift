/** Earl's verifier reads persisted evidence, never an agent-authored verdict.
 * Receipts establish provenance and policy consistency, not arbitrary-code safety.
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT, json, save, decision, safeFile } from "./core.mjs";

const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
const encode = (value) => JSON.stringify(stable(value));
const implementations = [
  "server/verifier.mjs", "server/core.mjs", "server/benchmark.mjs",
  "server/integration.mjs", "sdk/runtime.mjs",
  "server/instrument-build.mjs",
];
export async function sealVerificationPolicy(config, metric) {
  const files = {};
  for (const name of implementations)
    files[name] = hash(await fs.readFile(path.join(ROOT, name)));
  const policy = JSON.parse(JSON.stringify({ ...config, metric: metric || config.metric || "submitP95" }));
  const content = { version: 1, policy, implementations: files };
  return { ...content, hash: hash(encode(content)) };
}

export async function writeVerificationVerdict({ seal, config, metric, evidenceDir, referenceSourceDir, candidateSourceDir }) {
  const current = await sealVerificationPolicy(config, metric);
  if (!seal || seal.hash !== current.hash) {
    const error = Error("Verification policy or implementation changed during the experiment. Start a new run.");
    error.code = "VERIFICATION_POLICY_CHANGED";
    throw error;
  }
  const names = ["reference-metrics.json", "candidate-metrics.json", "guards.json", "measurement-order.json", "change.patch"];
  const artifacts = {};
  for (const name of names) {
    const bytes = await fs.readFile(path.join(evidenceDir, name));
    artifacts[name] = { sha256: hash(bytes), bytes: bytes.length };
  }
  const reference = await json(path.join(evidenceDir, names[0]));
  const candidate = await json(path.join(evidenceDir, names[1]));
  const guards = await json(path.join(evidenceDir, names[2]));
  const sources = { reference: {}, candidate: {} };
  if (!referenceSourceDir || !candidateSourceDir || !seal.policy.editableFiles?.length)
    throw Error("Verification requires reference and candidate source provenance.");
  for (const name of seal.policy.editableFiles) {
    for (const [version, directory] of [["reference", referenceSourceDir], ["candidate", candidateSourceDir]])
      sources[version][name] = hash(await fs.readFile(await safeFile(directory, name)));
  }
  const verdict = decision(reference?.summary, candidate?.summary, guards, seal.policy);
  const receipt = {
    version: 1,
    evaluatedAt: new Date().toISOString(),
    authority: "Earl deterministic verifier; optimizer cannot set the verdict",
    policyHash: seal.hash,
    policy: seal.policy,
    implementations: seal.implementations,
    artifacts,
    sources,
    verdict,
    coverage: {
      checkpoints: seal.policy.checkpoints?.length || 8,
      recordedEvents: seal.policy.scenario?.events?.length || 0,
      limitations: [
        "Passing checks establishes only the sampled scenes and interactions.",
        "Browser application state is observed through instrumentation; this is not a hostile-code security proof.",
        "CPU submission timing and frame pacing are not GPU utilization.",
      ],
    },
  };
  await save(path.join(evidenceDir, "verdict.json"), receipt);
  return { ...verdict, verifier: { version: 1, policyHash: seal.hash, artifact: "verdict.json" } };
}
