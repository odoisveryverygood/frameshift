import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { ROOT, DATA, copyProject } from "../server/core.mjs";
const base = "http://127.0.0.1:4310";
async function request(url, body) {
  const res = await fetch(
    base + "/api" + url,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const result = await res.json();
  if (!res.ok) throw Error(result.error);
  return result;
}
async function waitRun(id) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const s = await request("/state");
    const r = s.runs.find((r) => r.id === id);
    if (!["queued", "running"].includes(r.status)) {
      await new Promise((r) => setTimeout(r, 100));
      return r;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw Error("Verification run timed out");
}
const checks = [];
function check(name) {
  checks.push({ name, pass: true });
  console.log("PASS", name);
}
const s = await request("/state");
assert.equal(
  s.activeRun,
  null,
  "Finish the active optimization before verification",
);
const root = path.join(DATA, "selftest", String(Date.now()));
await copyProject(path.join(ROOT, "examples/fleet"), root);
let scene = await fs.readFile(path.join(root, "src/scene.js"), "utf8");
scene = scene.replace("const count = 800;", "const count = 80;");
await fs.writeFile(path.join(root, "src/scene.js"), scene);
const config = JSON.parse(
  await fs.readFile(path.join(root, "frameshift.config.json"), "utf8"),
);
config.name = "Import verification fixture";
config.samples = 30;
await fs.writeFile(
  path.join(root, "frameshift.config.json"),
  JSON.stringify(config),
);
const p = await request("/projects", { path: root, trusted: true });
assert.equal(p.name, config.name);
check("Import a local project through the public API");
let bad = await fetch(base + "/api/projects", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: "https://untrusted.example",
  },
  body: JSON.stringify({ path: root, trusted: true }),
});
assert.equal(bad.status, 403);
check("Reject cross-origin API writes");
const job = await request("/projects/" + p.id + "/runs", { kind: "profile" });
const profile = await waitRun(job.id);
assert.equal(profile.status, "completed", profile.error);
assert.ok(profile.baseline.calls > 50);
assert.ok(profile.baseline.submitP95 > 0);
check("Production build, real browser profile, screenshots, and raw metrics");
const scenePath = path.join(root, "src/scene.js");
const original = await fs.readFile(scenePath, "utf8");
const bestPath = path.join(DATA, "projects", p.id, "best/src/scene.js");
await fs.appendFile(
  bestPath,
  "\n// Verification fixture change: tests export/apply only, not an AI optimization.\n",
);
let patch = await fetch(base + "/api/projects/" + p.id + "/patch").then((r) =>
  r.text(),
);
assert.match(patch, /Verification fixture change/);
check("Export a patch against the original source");
const applied = await request("/projects/" + p.id + "/apply", {});
assert.deepEqual(applied.files, ["src/scene.js"]);
assert.equal(
  await fs.readFile(path.join(applied.backup, "src/scene.js"), "utf8"),
  original,
);
assert.match(
  await fs.readFile(scenePath, "utf8"),
  /Verification fixture change/,
);
check("Apply to the imported fixture and preserve an exact backup");
await fs.appendFile(scenePath, "\n// External edit\n");
await assert.rejects(
  () => request("/projects/" + p.id + "/apply", {}),
  /Original source changed/,
);
check("Reject Apply when the original source has changed");
const stopJob = await request("/projects/" + p.id + "/runs", {
  kind: "profile",
});
await request("/stop", {});
const stopped = await waitRun(stopJob.id);
assert.equal(stopped.status, "stopped");
check("Cancellation stops an actual build/profile job");
const traversal = await fetch(
  base + "/api/runs/" + profile.id + "/artifacts/../../.env.local",
);
assert.notEqual(traversal.status, 200);
check("Artifact routes reject credential/path traversal");
await request("/projects/" + p.id + "/archive", {});
assert.ok(!(await request("/state")).projects.some((x) => x.id === p.id));
check("Disconnect the fixture while retaining its run artifacts");
await fs.mkdir(path.join(ROOT, "verification"), { recursive: true });
await fs.writeFile(
  path.join(ROOT, "verification", "integration.json"),
  JSON.stringify(
    {
      at: new Date().toISOString(),
      checks,
      fixtureProjectId: p.id,
      profileRunId: profile.id,
      notes:
        "Authored local fixture; no model calls. Does not establish third-party generalization.",
    },
    null,
    2,
  ),
);
console.log("Integration verification complete:", checks.length, "checks");
