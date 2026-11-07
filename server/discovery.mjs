import fs from "node:fs/promises";
import path from "node:path";
const skipped = new Set([
  "node_modules",
  ".git",
  ".frameshift",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "coverage",
  "vendor",
  ".cache",
  ".turbo",
]);
const codePattern = /\.(?:[cm]?[jt]sx?|vue|svelte)$/;
const privatePattern =
  /(?:^|\/)(?:\.env[^/]*|credentials?[^/]*|secrets?[^/]*|.*\.(?:pem|key|p12))$/i;
async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw new Error(`Cannot read ${path.basename(file)}: ${e.message}`);
  }
}
export async function resolveProjectFolder(input) {
  if (typeof input !== "string" || !input.trim())
    throw Error("Paste the full path to your project folder.");
  const folder = input.trim();
  try {
    const root = await fs.realpath(folder);
    if (!(await fs.stat(root)).isDirectory())
      throw Error("Choose a project folder, rather than a file.");
    return root;
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error.code))
      throw Error("Project folder was not found. Check the pasted path and try again.");
    throw error;
  }
}
export async function discoverProject(input) {
  const root = await resolveProjectFolder(input);
  const pkg = await readJson(path.join(root, "package.json"));
  if (!pkg) throw new Error("Choose a project folder containing package.json.");
  const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
  const issues = [];
  const files = [];
  let totalBytes = 0;
  let limited = false;
  async function walk(dir, depth = 0) {
    if (depth > 12) return;
    const children = await fs.readdir(dir, { withFileTypes: true });
    for (const child of children) {
      if (
        child.isSymbolicLink() ||
        skipped.has(child.name) ||
        child.name.startsWith(".") ||
        privatePattern.test(child.name)
      )
        continue;
      const absolute = path.join(dir, child.name);
      const rel = path.relative(root, absolute).split(path.sep).join("/");
      if (child.isDirectory()) {
        await walk(absolute, depth + 1);
        continue;
      }
      if (!child.isFile() || !codePattern.test(child.name)) continue;
      if (files.length >= 450) {
        limited = true;
        continue;
      }
      const stat = await fs.stat(absolute);
      if (stat.size > 300000 || totalBytes + stat.size > 10000000) {
        limited = true;
        continue;
      }
      const source = await fs.readFile(absolute, "utf8");
      totalBytes += stat.size;
      const imports = [
        ...source.matchAll(
          /(?:\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?|\b(?:import|require)\s*\(\s*)['"]([^'"]+)['"]/g,
        ),
      ].map((m) => m[1]);
      files.push({
        path: rel,
        bytes: stat.size,
        imports: [...new Set(imports)],
        usesThree:
          /\b(?:from\s*['"]three(?:\/[^'"]*)?['"]|THREE\.|@react-three\/fiber|WebGLRenderer|InstancedMesh)/.test(
            source,
          ),
        exportsFactory: /export\s+(?:async\s+)?function\s+createWorld/.test(
          source,
        ),
      });
    }
  }
  await walk(root);
  const byPath = new Map(files.map((f) => [f.path, f]));
  for (const file of files) {
    file.dependencies = [];
    for (const name of file.imports) {
      if (!name.startsWith(".")) continue;
      const base = path.posix.normalize(
        path.posix.join(path.posix.dirname(file.path), name),
      );
      const resolved = [
        base,
        ...[".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts"].map(
          (ext) => base + ext,
        ),
        ...[".ts", ".tsx", ".js", ".jsx"].map((ext) => base + "/index" + ext),
      ].find((p) => byPath.has(p));
      if (resolved) file.dependencies.push(resolved);
    }
  }
  const manual = await readJson(path.join(root, "frameshift.config.json"));
  const vite = Boolean(
    dependencies.vite ||
    Object.values(pkg.scripts || {}).some((s) => /\bvite\b/.test(s)),
  );
  const next = Boolean(dependencies.next);
  const fiber = Boolean(
    dependencies["@react-three/fiber"] ||
    files.some((f) => f.imports.includes("@react-three/fiber")),
  );
  const hasThree = Boolean(
    dependencies.three || fiber || files.some((f) => f.usesThree),
  );
  const framework = next
    ? fiber
      ? "Next.js + React Three Fiber"
      : "Next.js"
    : vite
      ? fiber
        ? "Vite + React Three Fiber"
        : dependencies.react
          ? "Vite + React + Three.js"
          : "Vite + Three.js"
      : "Unrecognized build system";
  let threeVersion = dependencies.three || null;
  try {
    const installed = await readJson(
      path.join(root, "node_modules/three/package.json"),
    );
    if (installed?.version) threeVersion = installed.version;
  } catch {}
  let entryPoints = [];
  try {
    const html = await fs.readFile(path.join(root, "index.html"), "utf8");
    entryPoints = [
      ...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*['"]([^'"]+)['"][^>]*>/gi),
    ]
      .map((m) => m[1].replace(/^\//, ""))
      .filter((p) => byPath.has(p));
  } catch {}
  if (!entryPoints.length)
    entryPoints = [
      "src/main.tsx",
      "src/main.jsx",
      "src/main.ts",
      "src/main.js",
      "src/index.tsx",
      "src/index.jsx",
      "src/index.ts",
      "src/index.js",
      "app/page.tsx",
      "pages/index.tsx",
    ].filter((p) => byPath.has(p));
  let installed = false;
  try {
    await fs.access(path.join(root, "node_modules"));
    installed = true;
  } catch {}
  const supported = Boolean(vite && hasThree && !next);
  if (!hasThree)
    issues.push({
      severity: "error",
      code: "THREE_NOT_FOUND",
      message:
        "No Three.js or React Three Fiber dependency was detected. Choose the folder containing your 3D application.",
    });
  if (next)
    issues.push({
      severity: "error",
      code: "NEXT_REQUIRES_ADAPTER",
      message:
        "Next.js was detected. Automatic build instrumentation currently supports Vite applications. Export a Vite scene harness or provide a custom Earl adapter.",
    });
  else if (!vite)
    issues.push({
      severity: "error",
      code: "BUILD_SYSTEM_UNSUPPORTED",
      message:
        "Automatic instrumentation requires Vite. A custom configured production build and adapter can still be used.",
    });
  if (!pkg.scripts?.build)
    issues.push({
      severity: "error",
      code: "BUILD_SCRIPT_MISSING",
      message: "package.json needs a production build script before profiling.",
    });
  if (!installed)
    issues.push({
      severity: "warning",
      code: "DEPENDENCIES_NOT_INSTALLED",
      message:
        "Install this project’s dependencies before profiling. Earl does not install arbitrary project packages automatically.",
    });
  if (!entryPoints.length)
    issues.push({
      severity: "warning",
      code: "ENTRY_NOT_IDENTIFIED",
      message:
        "No standard entry module was identified. Check the application root and Vite configuration.",
    });
  if (limited)
    issues.push({
      severity: "warning",
      code: "SCAN_LIMIT",
      message:
        "The source map is bounded to 450 files / 10 MB. Large generated files were excluded.",
    });
  const ordered = files.sort(
    (a, b) =>
      Number(b.usesThree) - Number(a.usesThree) || a.path.localeCompare(b.path),
  );
  const config = {
    name: pkg.name || path.basename(root),
    buildCommand: ["npm", "run", "build"],
    outputDir: "dist",
    editableFiles: ordered
      .filter(
        (f) =>
          /\.[cm]?[jt]sx?$/.test(f.path) &&
          !/(?:^|\/)(?:vite|vitest|next|eslint|postcss|tailwind)\.config\./.test(
            f.path,
          ) &&
          !/(?:\.test|\.spec)\.[jt]sx?$/.test(f.path),
      )
      .map((f) => f.path),
    autoInstrument: true,
    metric: "submitP95",
    minImprovement: 0.08,
    maxVisualDifference: 0.01,
    samples: 60,
    repeats: 3,
  };
  return {
    root,
    name: pkg.name || path.basename(root),
    framework,
    threeVersion,
    entryPoints,
    files: ordered,
    dependencies,
    scripts: pkg.scripts || {},
    supported,
    installed,
    issues,
    manualConfig: manual,
    config,
  };
}
