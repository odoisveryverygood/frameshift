import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  within,
  safeFile,
  compareState,
  decision,
  assertVerificationContinuation,
  summarize,
  experimentStrategy,
  copyProject,
} from "../server/core.mjs";
const reference = {
  items: [
    ["robot-1", 1, 0, 0],
    ["robot-2", 1, 2, 3],
  ],
  picks: ["robot-1", null],
};
test("semantic guard rejects missing objects, moved objects, NaNs, and broken picking", () => {
  assert.equal(compareState(reference, structuredClone(reference)), true);
  for (const change of [
    (s) => s.items.pop(),
    (s) => (s.items[0][1] = 2),
    (s) => (s.items[0][1] = NaN),
    (s) => (s.picks[0] = "robot-2"),
  ]) {
    const c = structuredClone(reference);
    change(c);
    assert.equal(compareState(reference, c), false);
  }
});
test("performance acceptance requires guards, an improvement beyond noise, and stable frame pacing", () => {
  const ref = { submitP95: 10, frameP95: 20, repeatMetrics: [9.8, 10, 10.2] };
  assert.equal(
    decision(ref, { submitP95: 5, frameP95: 20, repeatMetrics: [5, 5, 5] }, { pass: true }, {}).status,
    "accepted",
  );
  assert.equal(
    decision(ref, { submitP95: 1, frameP95: 20, repeatMetrics: [1, 1, 1] }, { pass: false }, {}).status,
    "rejected",
  );
  assert.equal(
    decision(ref, { submitP95: 9.8, frameP95: 20, repeatMetrics: [9.8, 9.8, 9.8] }, { pass: true }, {}).status,
    "inconclusive",
  );
  assert.equal(
    decision(ref, { submitP95: 5, frameP95: 40, repeatMetrics: [5, 5, 5] }, { pass: true }, {}).status,
    "rejected",
  );
  assert.equal(
    decision(
      { ...ref, repeatMetrics: [5, 10, 15] },
      { submitP95: 8, frameP95: 20, repeatMetrics: [8, 8, 8] },
      { pass: true },
      {},
    ).status,
    "inconclusive",
  );
});
test("workspace paths reject traversal and escaping symlinks", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "frameshift-path-"));
  assert.throws(() => within(root, "../secret"));
  await fs.symlink("/etc", path.join(root, "escape"));
  await assert.rejects(() => safeFile(root, "escape/hosts"));
  await fs.rm(root, { recursive: true });
});
test("workspace copy excludes secrets, node_modules, git, and symlinks", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "frameshift-copy-"));
  const src = path.join(root, "source"),
    dest = path.join(root, "copy");
  await fs.mkdir(path.join(src, "src"), { recursive: true });
  await fs.mkdir(path.join(src, "node_modules"));
  await fs.mkdir(path.join(src, ".git"));
  await fs.writeFile(path.join(src, ".env.local"), "PRIVATE");
  await fs.writeFile(path.join(src, "src", "scene.js"), "code");
  await fs.symlink("/etc/hosts", path.join(src, "secret-link"));
  await copyProject(src, dest);
  assert.deepEqual(await fs.readdir(dest), ["src"]);
  assert.equal(
    await fs.readFile(path.join(dest, "src", "scene.js"), "utf8"),
    "code",
  );
  await fs.rm(root, { recursive: true });
});
test("summary retains raw measurement distinctions and repeat-level variability", () => {
  const result = summarize([
    { frames: [16, 17, 18], submit: [1, 2, 3], calls: 50, triangles: 100 },
    { frames: [16, 17, 19], submit: [2, 3, 4], calls: 50, triangles: 100 },
  ]);
  assert.equal(result.submitP95, 4);
  assert.equal(result.frameP95, 19);
  assert.deepEqual(result.repeatMetrics, [3, 4]);
  assert.equal(result.frameCount, 6);
});

test("draw-call goal requires fewer submissions while protecting CPU and frame pacing", () => {
  const ref = { calls: 1600, submitP95: 5, frameP95: 17, repeatMetrics: [5, 5, 5] };
  const config = { metric: "drawCalls", minImprovement: 0.08 };
  assert.equal(
    decision(
      ref,
      { calls: 13, submitP95: 1, frameP95: 17, repeatMetrics: [1, 1, 1] },
      { pass: true },
      config,
    ).status,
    "accepted",
  );
  assert.equal(
    decision(
      ref,
      { calls: 1600, submitP95: 1, frameP95: 17, repeatMetrics: [1, 1, 1] },
      { pass: true },
      config,
    ).status,
    "inconclusive",
  );
  assert.equal(
    decision(
      ref,
      { calls: 13, submitP95: 8, frameP95: 17, repeatMetrics: [8, 8, 8] },
      { pass: true },
      config,
    ).status,
    "rejected",
  );
  assert.equal(
    decision(
      ref,
      { calls: 13, submitP95: 1, frameP95: 17, repeatMetrics: [1, 1, 1] },
      { pass: false },
      config,
    ).status,
    "rejected",
  );
});

test("strategy tracks measured failures and resets a category after acceptance", () => {
  const failed = {
    title: "Hoist grid arithmetic",
    status: "inconclusive",
    candidate: { submitP95: 2 },
    reason: "Within noise",
  };
  const before = experimentStrategy([
    failed,
    failed,
    failed,
    { title: "Batch instancing", status: "rejected", guards: { pass: false } },
  ]);
  assert.equal(before.exhausted[0].category, "loop-arithmetic");
  assert.equal(before.categories.batching.failedTrials, 0);
  const after = experimentStrategy([
    failed,
    failed,
    failed,
    { title: "Hoist grid arithmetic", status: "accepted" },
  ]);
  assert.equal(after.exhausted.length, 0);
});


test("verifier rejects incomplete or nonfinite measurements and non-explicit guard success", () => {
  const ref = { calls: 1600, submitP95: 5, frameP95: 17, repeatMetrics: [5, 5, 5] };
  const candidate = { calls: 13, submitP95: 1, frameP95: 17, repeatMetrics: [1, 1, 1] };
  const config = { metric: "drawCalls" };
  for (const key of ["calls", "submitP95", "frameP95"]) {
    for (const value of [undefined, NaN, Infinity, -1]) {
      assert.equal(decision(ref, { ...candidate, [key]: value }, { pass: true }, config).status, "rejected");
      assert.equal(decision({ ...ref, [key]: value }, candidate, { pass: true }, config).status, "rejected");
    }
  }
  for (const guards of [null, {}, { pass: "true" }, { pass: 1 }])
    assert.equal(decision(ref, candidate, guards, config).status, "rejected");
  assert.equal(decision(ref, candidate, { pass: true }, { ...config, minImprovement: -1 }).status, "rejected");
});


test("empty, absent, insufficient and invalid repeats cannot bypass variability checks", () => {
  const ref = { calls: 400, submitP95: 10, frameP95: 17, repeatMetrics: [9.9, 10, 10.1] };
  const candidate = { calls: 2, submitP95: 1, frameP95: 17, repeatMetrics: [0.9, 1, 1.1] };
  for (const metric of ["drawCalls", "submitP95"]) {
    assert.equal(decision(ref, candidate, { pass: true }, { metric }).status, "accepted");
    for (const repeatMetrics of [undefined, [], [1], [1, NaN], [1, -1], [1, Infinity]]) {
      assert.equal(decision({ ...ref, repeatMetrics }, candidate, { pass: true }, { metric }).status, "rejected");
      assert.equal(decision(ref, { ...candidate, repeatMetrics }, { pass: true }, { metric }).status, "rejected");
    }
  }
});

test("resuming a sealed run requires the original verification policy", () => {
  assert.doesNotThrow(() => assertVerificationContinuation(undefined, "new-hash"));
  assert.doesNotThrow(() => assertVerificationContinuation({ version: 0 }, "new-hash"));
  assert.doesNotThrow(() => assertVerificationContinuation({ policyHash: "original" }, "original"));
  assert.throws(() => assertVerificationContinuation({ policyHash: "original" }, "changed"),
    (error) => error.code === "VERIFICATION_POLICY_CHANGED" && /Start a new run/.test(error.message));
});
