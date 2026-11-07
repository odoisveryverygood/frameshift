import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMission } from "../server/mission.mjs";

test("mission accepts plain text and multiline intent with a bounded payload", () => {
  assert.equal(normalizeMission(), "");
  assert.equal(normalizeMission("  Preserve physics.\nReduce CPU overhead.  "), "Preserve physics.\nReduce CPU overhead.");
  assert.equal(normalizeMission("x".repeat(4000)).length, 4000);
  for (const value of [null, {}, [], 12, true])
    assert.throws(() => normalizeMission(value), /must be text/);
  assert.throws(() => normalizeMission("x".repeat(4001)), /4,000/);
  assert.throws(() => normalizeMission("hi\0override"), /control characters/);
});
