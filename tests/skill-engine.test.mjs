import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applySkill } from "../server/skills/runtime.mjs";
import { generateSkill, trainingContext } from "../server/skills/generator.mjs";

async function workspace(t, entries = { "src/world.js": "export const count = 12;" }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "earl-skill-engine-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(entries)) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), content);
  }
  return root;
}
const generalSkill = { code: `function transform(files) {
  return {files: Object.entries(files).map(([path,content])=>({path,content:content.replace(/const ([a-z]+) = (\\d+);/g, 'let $1 = $2;')})),notes:'Conservative executable test transform'};
}` };

test("one executable skill transforms different source names and constants without a fixture lookup", async (t) => {
  for (const [name, source] of [["src/world.js", "export const count = 12;"], ["src/assembly.mjs", "export const cells = 413;"]]) {
    const root = await workspace(t, { [name]: source });
    const result = await applySkill({ skill: generalSkill, workspace: root, files: [name] });
    assert.deepEqual(result.changedFiles, [name]);
    assert.equal(await fs.readFile(path.join(root, name), "utf8"), source.replace("const", "let"));
    assert.match(result.sourceHashes[name], /^[a-f0-9]{64}$/);
  }
});

test("isolated transformer exposes no process, filesystem, or dynamic code generation", async (t) => {
  const root = await workspace(t);
  const skill = { code: `function transform(files) {
    if(typeof process!=='undefined'||typeof require!=='undefined'||typeof fetch!=='undefined') throw Error('Host capability exposed');
    let blocked=false;try {Function('return process')()}catch(e){blocked=true}
    if(!blocked)throw Error('Dynamic code generation exposed');
    return {files:[],notes:'No host capabilities'};
  }` };
  const result = await applySkill({ skill, workspace: root, files: ["src/world.js"] });
  assert.deepEqual(result.changedFiles, []);
  assert.equal(result.notes, "No host capabilities");
});

test("invalid later output cannot partially modify earlier valid source", async (t) => {
  const source = "export const count = 12;";
  const root = await workspace(t);
  const skill = { code: `function transform(files) {return {files:[{path:'src/world.js',content:'changed'},{path:'../secret.js',content:'bad'}]}}` };
  // Two allowed inputs allow validation to reach the second, invalid output.
  await fs.writeFile(path.join(root, "src/other.js"), "export const x=1");
  await assert.rejects(() => applySkill({ skill, workspace: root, files: ["src/world.js", "src/other.js"] }), /protected or invalid/);
  assert.equal(await fs.readFile(path.join(root, "src/world.js"), "utf8"), source);
});

test("skills cannot introduce protected profiler controls, unlisted paths, duplicates, or symlinks", async (t) => {
  const root = await workspace(t);
  for (const files of [
    [{ path: "src/world.js", content: "window.__frameshift={};" }],
    [{ path: "src/unlisted.js", content: "export const x=1" }],
    [{ path: "sdk/runtime.mjs", content: "export const x=1" }],
  ]) {
    const skill = { code: `function transform(files) {return ${JSON.stringify({ files })}}` };
    await assert.rejects(() => applySkill({ skill, workspace: root, files: ["src/world.js"] }), /protected|unlisted/);
  }
  await fs.symlink(path.join(root, "src/world.js"), path.join(root, "src/link.js"));
  await assert.rejects(() => applySkill({ skill: generalSkill, workspace: root, files: ["src/link.js"] }), /symlink/);
  assert.equal(await fs.readFile(path.join(root, "src/world.js"), "utf8"), "export const count = 12;");
});

test("runaway transformations time out and leave source unchanged", async (t) => {
  const root = await workspace(t);
  await assert.rejects(() => applySkill({ skill: { code: "function transform(files){while(true){}}" }, workspace: root, files: ["src/world.js"] }), /timed out/);
  assert.equal(await fs.readFile(path.join(root, "src/world.js"), "utf8"), "export const count = 12;");
});

test("no-op applicability remains explicit and aborted application never edits source", async (t) => {
  const root = await workspace(t);
  const result = await applySkill({ skill: { code: "function transform(files){return {files:[],notes:'Unsupported shape'}}" }, workspace: root, files: ["src/world.js"] });
  assert.deepEqual(result.changedFiles, []);
  assert.equal(result.notes, "Unsupported shape");
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => applySkill({ skill: generalSkill, workspace: root, files: ["src/world.js"], signal: controller.signal }), /abort/i);
});

test("generation context rejects held-out feedback and never forwards arbitrary context fields", () => {
  assert.throws(() => trainingContext({ trainingFiles: { "src/world.js": "source" }, feedback: [{ split: "heldout", error: "do not learn this" }] }), /training feedback only/);
  const context = trainingContext({ trainingFiles: { "src/world.js": "source" }, feedback: [{ status: "rejected", reason: "Training selection failed", heldoutSource: "HIDDEN-CODE", privatePath: "/private/secret" }], parentSkill: { name: "old", description: "test", code: "function transform(files){}", heldoutFixtures: "HIDDEN-CODE" } });
  assert.doesNotMatch(JSON.stringify(context), /HIDDEN-CODE|privatePath|heldoutFixtures/);
});

test("real provider transport is bounded, uses only training context, and never fabricates malformed skills", async (t) => {
  const previousFetch = globalThis.fetch;
  const previous = Object.fromEntries(["OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_BASE_URL", "LLM_API_PROTOCOL"].map((key) => [key, process.env[key]]));
  t.after(() => { globalThis.fetch = previousFetch; for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value; });
  process.env.OPENAI_API_KEY = "test-key-not-a-real-credential";
  process.env.OPENAI_MODEL = "test-model";
  process.env.OPENAI_BASE_URL = "https://provider.invalid/v1";
  for (const protocol of ["responses", "chat-completions"]) {
    process.env.LLM_API_PROTOCOL = protocol;
    globalThis.fetch = async (url, options) => {
      assert.match(url, protocol === "responses" ? /\/responses$/ : /\/chat\/completions$/);
      const payload = JSON.parse(options.body);
      const context = JSON.parse(protocol === "responses" ? payload.input : payload.messages[1].content);
      assert.equal(context.split, "training");
      assert.deepEqual(Object.keys(context.trainingFiles), ["src/world.js"]);
      assert.doesNotMatch(JSON.stringify(payload), /HIDDEN-CODE/);
      const text = JSON.stringify({ name: "portable-skill", description: "A test of provider transport", code: generalSkill.code });
      return new Response(JSON.stringify(protocol === "responses" ? { output: [{ type: "message", content: [{ type: "output_text", text }] }], usage: { input_tokens: 5 } } : { choices: [{ message: { content: text } }], usage: { total_tokens: 6 } }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const skill = await generateSkill({ trainingFiles: { "src/world.js": "export const count=12" }, feedback: [] });
    assert.equal(skill.name, "portable-skill");
    assert.equal(skill.model, "test-model");
  }
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "not-json" } }] }), { status: 200 });
  await assert.rejects(() => generateSkill({ trainingFiles: { "src/world.js": "source" } }), /invalid JSON/);
});
