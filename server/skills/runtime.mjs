/** Apply a generated source transformation; never run it inside the web worker. */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { command } from "../core.mjs";

const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
const executor = fileURLToPath(new URL("./execute.mjs", import.meta.url));
const blocked = /(^|\/)(?:node_modules|\.git|\.frameshift|dist|build|coverage|vendor|sdk|server|tests?|__tests__)(?:\/|$)|(^|\/)\.env(?:[./]|$)|(?:^|\/)(?:frameshift\.config|vite\.config|benchmark|playwright\.config)\b|\.(?:test|spec)\.[cm]?[jt]sx?$/i;

export function normalizeSkillPath(name) {
  if (typeof name !== "string" || name.length > 300 || !name ||
      name.includes("\\") || name.startsWith("/") ||
      name.split("/").some((part) => ["", ".", ".."].includes(part)) ||
      blocked.test(name) || !/\.[cm]?[jt]sx?$/i.test(name))
    throw Error("Skill attempted a protected or invalid source path");
  return name;
}

async function sourceFile(root, name) {
  normalizeSkillPath(name);
  let cursor = root;
  for (const part of name.split("/")) {
    cursor = path.join(cursor, part);
    if ((await fs.lstat(cursor)).isSymbolicLink()) throw Error("Skill source symlinks are unavailable");
  }
  const stat = await fs.stat(cursor);
  if (!stat.isFile() || stat.size > 240000) throw Error("Skill source exceeds the 240 KB file limit");
  return cursor;
}

function checkProtectedControls(before, after) {
  for (const expression of [
    /__frameshift/g, /__FRAMESHIFT/g, /navigator\s*\.\s*webdriver/g,
    /performance\s*\.\s*now\s*=/g, /Math\s*\.\s*random\s*=/g,
    /\.info\s*\.render\s*\.(?:calls|triangles)\s*=/g,
    /(?:window|globalThis)\s*\[\s*["']__frameshift/g,
  ]) if ((after.match(expression) || []).length > (before.match(expression) || []).length)
    throw Error("Skill introduces protected instrumentation or benchmark-control access");
}

export async function applySkill({ skill, workspace, files, signal } = {}) {
  signal?.throwIfAborted();
  if (typeof skill?.code !== "string" || skill.code.length < 20 || skill.code.length > 100000)
    throw Error("An executable generated skill is required");
  if (!Array.isArray(files) || files.length < 1 || files.length > 180)
    throw Error("A skill requires 1–180 explicitly allowed source files");
  const root = await fs.realpath(workspace);
  const names = [...new Set(files.map(normalizeSkillPath))];
  const original = {}, locations = {}, sourceHashes = {};
  let total = 0;
  for (const name of names) {
    locations[name] = await sourceFile(root, name);
    original[name] = await fs.readFile(locations[name], "utf8");
    total += original[name].length;
    if (total > 2000000) throw Error("Skill input exceeds the 2 MB source budget");
    sourceHashes[name] = digest(original[name]);
  }
  const directory = path.join(root, ".frameshift-build", "skill-" + crypto.randomUUID());
  await fs.mkdir(directory, { recursive: true });
  const input = path.join(directory, "input.json"), output = path.join(directory, "output.json");
  let result;
  try {
    await fs.writeFile(input, JSON.stringify({ code: skill.code, files: original }), { mode: 0o600 });
    await command([process.execPath, "--max-old-space-size=128", executor, input, output], root, {
      isolate: true, signal, timeout: 12000,
    });
    const stat = await fs.stat(output);
    if (stat.size > 3000000) throw Error("Skill output exceeds the 3 MB limit");
    result = JSON.parse(await fs.readFile(output, "utf8"));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
  if (!result || !Array.isArray(result.files) || result.files.length > names.length)
    throw Error("Skill must return a bounded files array");
  if (result.notes != null && typeof result.notes !== "string")
    throw Error("Skill notes must be text");
  const changes = [], seen = new Set();
  for (const file of result.files) {
    const name = normalizeSkillPath(file?.path);
    if (!Object.hasOwn(original, name) || seen.has(name))
      throw Error("Skill attempted an unlisted or duplicate source path");
    seen.add(name);
    if (typeof file.content !== "string" || file.content.length > 240000)
      throw Error("Skill returned invalid or oversized source content");
    checkProtectedControls(original[name], file.content);
    if (file.content !== original[name]) changes.push({ path: name, content: file.content });
  }
  // Check every source again before staging any writes. Validation of one bad
  // output must not leave an earlier valid output partially applied.
  for (const name of names) {
    const location = await sourceFile(root, name);
    if (digest(await fs.readFile(location, "utf8")) !== sourceHashes[name])
      throw Error("Source changed while applying the skill; retry from a fresh copy");
  }
  signal?.throwIfAborted();
  const staged = [], written = [];
  try {
    for (const file of changes) {
      const temp = locations[file.path] + ".earl-" + crypto.randomUUID() + ".tmp";
      await fs.writeFile(temp, file.content, { flag: "wx", mode: 0o600 });
      staged.push({ ...file, temp });
    }
    for (const file of staged) {
      signal?.throwIfAborted();
      await fs.rename(file.temp, locations[file.path]);
      written.push(file.path);
    }
  } catch (error) {
    for (const name of written) await fs.writeFile(locations[name], original[name]);
    throw error;
  } finally {
    await Promise.all(staged.map((file) => fs.unlink(file.temp).catch(() => {})));
  }
  return { changedFiles: changes.map((file) => file.path), notes: (result.notes || "").slice(0, 4000), sourceHashes };
}
