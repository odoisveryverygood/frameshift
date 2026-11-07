import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { discoverProject, resolveProjectFolder } from "../server/discovery.mjs";
test("pasted project paths ignore surrounding whitespace and explain missing folders", async () => {
  const folder = new URL("./fixtures/plain-three", import.meta.url).pathname;
  assert.equal(await resolveProjectFolder(" \n" + folder + " \n"), await fs.realpath(folder));
  assert.equal((await discoverProject(folder + " ")).supported, true);
  await assert.rejects(() => resolveProjectFolder(" "), /Paste the full path/);
  await assert.rejects(() => resolveProjectFolder(folder + "/missing"), /Project folder was not found/);
});
test("discovers plain Vite Three.js entry and dependency graph without a manual adapter", async () => {
  const report = await discoverProject(
    new URL("./fixtures/plain-three", import.meta.url).pathname,
  );
  assert.equal(report.supported, true);
  assert.equal(report.framework, "Vite + Three.js");
  assert.deepEqual(report.entryPoints, ["src/main.js"]);
  assert.ok(report.files.find((f) => f.path === "src/main.js").usesThree);
  assert.equal(report.config.autoInstrument, true);
  assert.equal(report.manualConfig, null);
});
test("source discovery excludes secrets and symlinks, resolves local imports, identifies R3F and unsupported Next", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "frameshift-discover-"));
  try {
    await fs.mkdir(path.join(root, "src"));
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "fiber-app",
        dependencies: {
          vite: "7",
          three: "0.181",
          "@react-three/fiber": "9",
          react: "19",
        },
        scripts: { build: "vite build" },
      }),
    );
    await fs.writeFile(
      path.join(root, "index.html"),
      '<script type="module" src="/src/main.tsx"></script>',
    );
    await fs.writeFile(
      path.join(root, "src/main.tsx"),
      "import {World} from './world';import {Canvas} from '@react-three/fiber';",
    );
    await fs.writeFile(
      path.join(root, "src/world.ts"),
      "export const World=()=>null;",
    );
    await fs.writeFile(path.join(root, ".env.local"), "PRIVATE");
    await fs.symlink("/etc/hosts", path.join(root, "src/escape.js"));
    let d = await discoverProject(root);
    assert.match(d.framework, /React Three Fiber/);
    assert.deepEqual(
      d.files.find((f) => f.path === "src/main.tsx").dependencies,
      ["src/world.ts"],
    );
    assert.ok(
      !d.files.some(
        (f) => f.path.includes("escape") || f.path.includes(".env"),
      ),
    );
    const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json")));
    pkg.dependencies.next = "16";
    delete pkg.dependencies.vite;
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify(pkg));
    d = await discoverProject(root);
    assert.equal(d.supported, false);
    assert.ok(d.issues.some((i) => i.code === "NEXT_REQUIRES_ADAPTER"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
