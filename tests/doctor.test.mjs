import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  diagnoseProject,
  findChrome,
  parseOptions,
} from "../scripts/doctor.mjs";

const doctor = fileURLToPath(new URL("../scripts/doctor.mjs", import.meta.url));
const environment = {
  nodeVersion: "22.0.0",
  chrome: async () => "/test/chrome",
};
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "earl-doctor-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const pkg = {
    name: "portable-fixture",
    scripts: { build: "vite build" },
    dependencies: { three: "0.181.0" },
    devDependencies: { vite: "7.3.7" },
  };
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify(pkg));
  await fs.writeFile(
    path.join(root, "index.html"),
    '<script type="module" src="/src/main.js"></script>',
  );
  await fs.writeFile(
    path.join(root, "src/main.js"),
    "import * as THREE from 'three';",
  );
  // Package metadata fixtures only. No imported code or simulated live benchmark.
  for (const [name, version] of [
    ["three", "0.181.0"],
    ["vite", "7.3.7"],
  ]) {
    await fs.mkdir(path.join(root, "node_modules", name), { recursive: true });
    await fs.writeFile(
      path.join(root, "node_modules", name, "package.json"),
      JSON.stringify({ name, version }),
    );
  }
  return {
    root,
    pkg,
    write: () =>
      fs.writeFile(path.join(root, "package.json"), JSON.stringify(pkg)),
  };
}
const codes = (report) =>
  report.findings
    .filter((finding) => finding.severity === "error")
    .map((finding) => finding.code);

test("doctor is read-only, normalizes whitespace and reports structured ready prerequisites", async (t) => {
  const { root, pkg, write } = await fixture(t);
  pkg.scripts.build = "node -e \"require('fs').writeFileSync('BUILT','bad')\"";
  await write();
  await fs.writeFile(path.join(root, ".env.local"), "API_KEY=NEVER_PRINT_THIS");
  const before = await fs.readdir(root, { recursive: true });
  const report = await diagnoseProject(" \n" + root + "  ", environment);
  assert.equal(report.ready, true);
  assert.deepEqual(report.project.entryPoints, ["src/main.js"]);
  for (const finding of report.findings) {
    assert.equal(typeof finding.code, "string");
    assert.ok(["error", "warning", "info"].includes(finding.severity));
    assert.equal(typeof finding.remediation, "string");
  }
  assert.deepEqual(await fs.readdir(root, { recursive: true }), before);
  assert.doesNotMatch(
    JSON.stringify(report),
    /NEVER_PRINT_THIS|writeFileSync|BUILT/,
  );
});

test("doctor distinguishes missing folder, file, missing manifest and malformed package data without echoing it", async (t) => {
  const { root } = await fixture(t);
  assert.ok(
    codes(
      await diagnoseProject(path.join(root, "missing"), environment),
    ).includes("FOLDER_NOT_FOUND"),
  );
  assert.ok(
    codes(
      await diagnoseProject(path.join(root, "index.html"), environment),
    ).includes("FOLDER_NOT_DIRECTORY"),
  );
  await fs.unlink(path.join(root, "package.json"));
  assert.ok(
    codes(await diagnoseProject(root, environment)).includes("PACKAGE_MISSING"),
  );
  for (const invalid of [
    '{"secret":"NEVER_PRINT_THIS"',
    "null",
    "[]",
    '"text"',
    '{"scripts":[]}',
    '{"dependencies":{"three":42}}',
  ]) {
    await fs.writeFile(path.join(root, "package.json"), invalid);
    const report = await diagnoseProject(root, environment);
    assert.ok(codes(report).includes("PACKAGE_INVALID"));
    assert.doesNotMatch(JSON.stringify(report), /NEVER_PRINT_THIS/);
  }
});

test("doctor blocks unsupported framework and build, runtime, browser and dependency prerequisites", async (t) => {
  const { root, pkg, write } = await fixture(t);
  pkg.dependencies.next = "16";
  delete pkg.scripts.build;
  await write();
  await fs.rm(path.join(root, "node_modules", "vite"), { recursive: true });
  const report = await diagnoseProject(root, {
    nodeVersion: "20.19.0",
    chrome: async () => null,
  });
  assert.equal(report.ready, false);
  for (const code of [
    "NODE_UNSUPPORTED",
    "CHROME_MISSING",
    "FRAMEWORK_UNSUPPORTED",
    "NEXT_REQUIRES_ADAPTER",
    "BUILD_SCRIPT_MISSING",
    "DEPENDENCIES_MISSING",
  ])
    assert.ok(codes(report).includes(code), code);
  assert.ok(
    report.findings
      .filter((f) => f.severity === "error")
      .every((f) => f.remediation),
  );
});

test("an empty node_modules directory does not establish installed dependencies", async (t) => {
  const { root } = await fixture(t);
  await fs.rm(path.join(root, "node_modules"), { recursive: true });
  await fs.mkdir(path.join(root, "node_modules"));
  const report = await diagnoseProject(root, environment);
  assert.ok(codes(report).includes("DEPENDENCIES_MISSING"));
  assert.ok(codes(report).includes("THREE_NOT_INSTALLED"));
});

test("entry warnings remain distinct from blockers and an old Three.js is blocked", async (t) => {
  const { root } = await fixture(t);
  await fs.rename(
    path.join(root, "src/main.js"),
    path.join(root, "src/unusual.js"),
  );
  let report = await diagnoseProject(root, environment);
  assert.equal(report.ready, true);
  assert.ok(
    report.findings.some(
      (f) => f.code === "ENTRY_NOT_IDENTIFIED" && f.severity === "warning",
    ),
  );
  await fs.writeFile(
    path.join(root, "node_modules/three/package.json"),
    '{"version":"0.149.0"}',
  );
  report = await diagnoseProject(root, environment);
  assert.ok(codes(report).includes("THREE_VERSION_UNSUPPORTED"));
});

test("doctor identifies WebGPU imports as an unsupported automatic path", async (t) => {
  const { root } = await fixture(t);
  await fs.writeFile(
    path.join(root, "src/main.js"),
    "import {WebGPURenderer} from 'three/webgpu';",
  );
  const report = await diagnoseProject(root, environment);
  assert.ok(codes(report).includes("WEBGPU_UNSUPPORTED"));
});

test("doctor handles invalid optional configuration without printing its contents", async (t) => {
  const { root } = await fixture(t);
  await fs.writeFile(
    path.join(root, "frameshift.config.json"),
    '{"token":"NEVER_PRINT_THIS"',
  );
  const report = await diagnoseProject(root, environment);
  assert.ok(codes(report).includes("CONFIG_INVALID"));
  assert.doesNotMatch(JSON.stringify(report), /NEVER_PRINT_THIS/);
});

test("Chrome search checks executable files without launching them", async (t) => {
  const { root } = await fixture(t);
  const chromePath = path.join(root, "chrome.exe");
  await fs.writeFile(chromePath, "not executable code");
  assert.equal(
    await findChrome({ platform: "win32", env: { PATH: root }, home: root }),
    chromePath,
  );
  await fs.unlink(chromePath);
  assert.equal(
    await findChrome({ platform: "win32", env: { PATH: root }, home: root }),
    null,
  );
});

test("doctor CLI returns nonzero parseable JSON for usage and project blockers", async (t) => {
  const { root } = await fixture(t);
  for (const args of [
    [path.join(root, "missing"), "--json"],
    ["--unknown", "--json"],
    ["a", "b", "--json"],
  ]) {
    const result = spawnSync(process.execPath, [doctor, ...args], {
      encoding: "utf8",
    });
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ready, false);
    assert.ok(report.findings.some((f) => f.severity === "error"));
    assert.equal(result.stderr, "");
  }
  assert.equal(spawnSync(process.execPath, [doctor, "--help"]).status, 0);
  assert.equal(
    parseOptions([" ./app  ", "--json"], root).folder,
    path.join(root, "app"),
  );
  assert.throws(() => parseOptions(["  "]), /nonempty/);
});

test("doctor never echoes credential-bearing dependency specifications", async (t) => {
  const { root, pkg, write } = await fixture(t);
  pkg.dependencies.three =
    "https://user:NEVER_PRINT_THIS@registry.invalid/three.tgz";
  await write();
  await fs.rm(path.join(root, "node_modules/three"), { recursive: true });
  const report = await diagnoseProject(root, environment);
  assert.equal(report.project.threeVersion, null);
  assert.doesNotMatch(
    JSON.stringify(report),
    /NEVER_PRINT_THIS|registry.invalid/,
  );
});
