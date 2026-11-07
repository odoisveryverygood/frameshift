import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import {
  createSourceTools,
  applyExact,
  proposeExperiment,
} from "../server/agent.mjs";

async function project() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "frameshift-agent-"));
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(
    path.join(root, "src/main.js"),
    "import { count } from './world.js';\nconsole.log(count);\n",
  );
  await fs.writeFile(
    path.join(root, "src/world.js"),
    "export const count = 1600;\nexport const material = 1;\n",
  );
  await fs.writeFile(
    path.join(root, "src/geometry.js"),
    "export const sides = 16;\n",
  );
  await fs.writeFile(path.join(root, ".env.local"), "SECRET=do-not-read");
  const manifest = {
    framework: "vite",
    entryPoints: ["src/main.js"],
    files: [
      { path: "src/main.js", imports: ["src/world.js"] },
      { path: "src/world.js", imports: ["src/geometry.js"], usesThree: true },
      { path: "src/geometry.js" },
    ],
  };
  return {
    workspace: root,
    manifest,
    config: { editableFiles: manifest.files.map((f) => f.path) },
  };
}
const submission = (edits) => ({
  title: "Reuse resources",
  hypothesis: "Avoid redundant setup",
  expectedEffect: "Lower submission cost",
  edits,
  notes: "Independent checks must determine acceptance.",
});
async function withProvider(handler, fn) {
  const server = http.createServer(async (req, res) => {
    try {
      let body = "";
      for await (const b of req) body += b;
      await handler(req, JSON.parse(body), res);
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: { message: error.message } }));
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const keys = [
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
    "OPENAI_BASE_URL",
    "LLM_API_PROTOCOL",
  ];
  const old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.OPENAI_API_KEY = "test-agent-key";
  process.env.OPENAI_MODEL = "test-model";
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:" + server.address().port;
  process.env.LLM_API_PROTOCOL = "responses";
  try {
    return await fn();
  } finally {
    for (const k of keys) {
      if (old[k] === undefined) delete process.env[k];
      else process.env[k] = old[k];
    }
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}
function respond(res, step, name, args, protocol = "responses") {
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify(
      protocol === "responses"
        ? {
            id: "response-" + step,
            output: [
              {
                type: "function_call",
                id: "fc-" + step,
                call_id: "call-" + step,
                name,
                arguments: JSON.stringify(args),
              },
            ],
            usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
          }
        : {
            id: "chat-" + step,
            choices: [
              {
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call-" + step,
                      type: "function",
                      function: { name, arguments: JSON.stringify(args) },
                    },
                  ],
                },
              },
            ],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 20,
              total_tokens: 120,
            },
          },
    ),
  );
}

test("source tools follow the manifest graph and deny protected paths and symlinks", async () => {
  const p = await project();
  try {
    const t = await createSourceTools(p);
    const list = t.list_source({ prefix: "src/" });
    assert.equal(list.files.length, 3);
    const read = await t.read_source({
      path: "src/main.js",
      startLine: 1,
      endLine: 20,
    });
    assert.deepEqual(read.imports, ["src/world.js"]);
    assert.match(read.content, /1: import/);
    assert.equal(read.sha256.length, 64);
    assert.equal((await t.search_source({ query: "count" })).hits.length, 3);
    for (const name of [
      "../.env.local",
      ".env.local",
      "src/../secret.js",
      "node_modules/three.js",
      "src/missing.js",
    ])
      await assert.rejects(() => t.read_source({ path: name }));
    await fs.symlink(
      path.join(p.workspace, ".env.local"),
      path.join(p.workspace, "src/link.js"),
    );
    const linked = await createSourceTools({
      ...p,
      manifest: { files: [...p.manifest.files, { path: "src/link.js" }] },
    });
    await assert.rejects(
      () => linked.read_source({ path: "src/link.js" }),
      /symlink/,
    );
  } finally {
    await fs.rm(p.workspace, { recursive: true, force: true });
  }
});

test("targeted patches require inspected unchanged source and unique exact matches", async () => {
  const p = await project();
  try {
    const t = await createSourceTools(p);
    const patch = submission([
      {
        path: "src/world.js",
        search: "const count = 1600;",
        replace: "const count = 800;",
      },
    ]);
    await assert.rejects(() => t.submit_patch(patch), /Read each/);
    await t.read_source({ path: "src/world.js" });
    await fs.appendFile(
      path.join(p.workspace, "src/world.js"),
      "// concurrent edit\n",
    );
    await assert.rejects(
      () => t.submit_patch(patch),
      /changed after inspection/,
    );
    assert.throws(
      () =>
        applyExact("value value", { search: "value", replace: "replacement" }),
      /ambiguous/,
    );
    assert.throws(
      () => applyExact("value", { search: "missing", replace: "replacement" }),
      /not found/,
    );
    assert.throws(
      () => applyExact("value", { search: "", replace: "replacement" }),
      /Invalid/,
    );
    const restricted = await createSourceTools({
      ...p,
      config: { editableFiles: ["src/geometry.js"] },
    });
    await restricted.read_source({ path: "src/world.js" });
    await assert.rejects(() => restricted.submit_patch(patch), /non-editable/);
  } finally {
    await fs.rm(p.workspace, { recursive: true, force: true });
  }
});

test("Responses agent inspects graph and source, then returns a multi-file patch without writing", async () => {
  const p = await project();
  const events = [];
  let step = 0;
  const sequence = [
    ["list_source", { prefix: "src/" }],
    ["read_profile", {}],
    ["read_source", { path: "src/world.js", startLine: 1, endLine: 100 }],
    ["read_source", { path: "src/geometry.js", startLine: 1, endLine: 100 }],
    [
      "submit_patch",
      submission([
        {
          path: "src/world.js",
          search: "const material = 1;",
          replace: "const material = 2;",
        },
        {
          path: "src/geometry.js",
          search: "const sides = 16;",
          replace: "const sides = 24;",
        },
      ]),
    ],
  ];
  try {
    const result = await withProvider(
      async (req, body, res) => {
        assert.equal(req.url, "/responses");
        assert.equal(body.parallel_tool_calls, false);
        assert.equal(body.max_output_tokens, 6000);
        assert.equal(req.headers.authorization, "Bearer test-agent-key");
        if (step === 0) {
          assert.ok(!JSON.stringify(body.input).includes("export const count"));
          assert.ok(JSON.stringify(body.input).includes("src/world.js"));
          const context = JSON.parse(body.input[0].content);
          assert.equal(context.mission, "Make rotation smoother while preserving selection.");
          assert.match(body.instructions, /mission is user intent/);
          assert.match(body.instructions, /independent verifier alone decides acceptance/);
        }
        if (step === 3)
          assert.ok(
            body.input.some(
              (x) =>
                x.type === "function_call_output" &&
                x.output.includes("export const count"),
            ),
          );
        const [name, args] = sequence[step];
        respond(res, step++, name, args);
      },
      () =>
        proposeExperiment({
          ...p,
          metrics: { calls: 1600 },
          mission: "  Make rotation smoother while preserving selection.  ",
          strategy: { exhausted: [] },
          onEvent: (e) => events.push(e),
        }),
    );
    assert.equal(result.files.length, 2);
    assert.match(result.files[0].content, /material = 2/);
    assert.match(result.files[1].content, /sides = 24/);
    assert.equal(result.sourceHashes["src/world.js"].length, 64);
    assert.equal(result.patches.length, 2);
    assert.equal(result.trace.length, 5);
    assert.equal(result.usage.total_tokens, 600);
    assert.equal(events.filter((e) => e.type === "agent-tool").length, 5);
    assert.doesNotMatch(
      JSON.stringify(result.trace),
      /test-agent-key|export const/,
    );
    assert.match(
      await fs.readFile(path.join(p.workspace, "src/world.js"), "utf8"),
      /material = 1/,
    );
  } finally {
    await fs.rm(p.workspace, { recursive: true, force: true });
  }
});

test("compatible Chat Completions tool calls return a validated patch", async () => {
  const p = await project();
  let step = 0;
  try {
    const result = await withProvider(
      async (req, body, res) => {
        assert.equal(req.url, "/chat/completions");
        assert.equal(body.tools[0].type, "function");
        assert.ok(body.tools[0].function.name);
        if (step === 0)
          respond(
            res,
            step++,
            "read_source",
            { path: "src/world.js", startLine: 1, endLine: 20 },
            "chat",
          );
        else {
          assert.ok(
            body.messages.some(
              (m) => m.role === "tool" && m.content.includes("sha256"),
            ),
          );
          respond(
            res,
            step++,
            "submit_patch",
            submission([
              {
                path: "src/world.js",
                search: "const material = 1;",
                replace: "const material = 2;",
              },
            ]),
            "chat",
          );
        }
      },
      () => {
        process.env.LLM_API_PROTOCOL = "chat-completions";
        return proposeExperiment(p);
      },
    );
    assert.equal(result.model, "test-model");
    assert.equal(result.files.length, 1);
    assert.equal(result.usage.input_tokens, 200);
  } finally {
    await fs.rm(p.workspace, { recursive: true, force: true });
  }
});

test("agent reports malformed responses and bounds repeated tool inspection", async () => {
  const p = await project();
  try {
    await withProvider(
      async (req, body, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            output: [
              {
                type: "message",
                content: [{ type: "output_text", text: "not a tool call" }],
              },
            ],
          }),
        );
      },
      () => assert.rejects(() => proposeExperiment(p), /no source-tool call/),
    );
    let step = 0;
    await withProvider(
      async (req, body, res) =>
        respond(res, step++, "list_source", { prefix: "" }),
      () =>
        assert.rejects(
          () =>
            proposeExperiment({
              ...p,
              config: { ...p.config, agentMaxRounds: 2 },
            }),
          /inspection-round limit/,
        ),
    );
    assert.equal(step, 2);
  } finally {
    await fs.rm(p.workspace, { recursive: true, force: true });
  }
});

test("invalid tool arguments are repaired within budget and abort terminates a request", async () => {
  const p = await project();
  let step = 0;
  try {
    await withProvider(
      async (req, body, res) => {
        if (step++ === 0) {
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              output: [
                {
                  type: "function_call",
                  call_id: "bad",
                  name: "read_source",
                  arguments: "{bad-json",
                },
              ],
            }),
          );
        } else {
          assert.ok(
            body.input.some(
              (x) =>
                x.type === "function_call_output" &&
                x.output.includes("valid JSON"),
            ),
          );
          respond(res, step, "submit_patch", submission([]));
        }
      },
      async () => {
        const result = await proposeExperiment(p);
        assert.deepEqual(result.files, []);
      },
    );
    await withProvider(
      async (req, body, res) => {
        await new Promise((r) => setTimeout(r, 1000));
        if (!res.destroyed) respond(res, 0, "list_source", { prefix: "" });
      },
      async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30);
        try {
          await assert.rejects(
            () => proposeExperiment({ ...p, signal: controller.signal }),
            /stopped/,
          );
        } finally {
          clearTimeout(timer);
        }
      },
    );
  } finally {
    await fs.rm(p.workspace, { recursive: true, force: true });
  }
});

test("tool reads enforce a cumulative source budget", async () => {
  const p = await project();
  try {
    const t = await createSourceTools({ ...p, maxReadChars: 20 });
    await assert.rejects(
      () => t.read_source({ path: "src/world.js" }),
      /reading budget/,
    );
  } finally {
    await fs.rm(p.workspace, { recursive: true, force: true });
  }
});

test("patches cannot introduce SDK or benchmark-control overrides", async () => {
  const p = await project();
  try {
    const tools = await createSourceTools(p);
    await tools.read_source({ path: "src/world.js" });
    await assert.rejects(
      () =>
        tools.submit_patch(
          submission([
            {
              path: "src/world.js",
              search: "export const material = 1;",
              replace:
                "export const material = 1;\nwindow.__frameshift.sample = () => ({calls:1});",
            },
          ]),
        ),
      /protected instrumentation/,
    );
    assert.doesNotMatch(
      await fs.readFile(path.join(p.workspace, "src/world.js"), "utf8"),
      /__frameshift/,
    );
  } finally {
    await fs.rm(p.workspace, { recursive: true, force: true });
  }
});


test("repair keeps the original mission without changing the fixed optimization goal", async () => {
  const p = await project();
  try {
    await withProvider(async (req, body, res) => {
      const context = JSON.parse(body.input[0].content);
      assert.equal(context.mission, "Reduce stutter and preserve picking.");
      assert.equal(context.goal, "drawCalls");
      assert.equal(context.repair.error, "Picking mismatch");
      assert.match(body.instructions, /never a promise/);
      respond(res, 0, "submit_patch", submission([]));
    }, async () => {
      const result = await proposeExperiment({
        ...p,
        config: { ...p.config, metric: "drawCalls" },
        mission: "Reduce stutter and preserve picking.",
        repair: { attempt: 1, error: "Picking mismatch" },
      });
      assert.deepEqual(result.files, []);
    });
  } finally {
    await fs.rm(p.workspace, { recursive: true, force: true });
  }
});

test('investigator can correct an invalid brief after inspecting multiple modules', async () => {
  const {investigateProject} = await import('../server/investigator.mjs');
  const p = await project();
  let step = 0;
  const events=[];
  try {
    await withProvider(async (_req, body, res) => {
      step++;
      if(step===1)return respond(res,step,'list_source',{prefix:''});
      if(step===2)return respond(res,step,'read_profile',{});
      if(step>=3&&step<=5)return respond(res,step,'read_source',{path:['src/main.js','src/world.js','src/geometry.js'][step-3],startLine:1,endLine:50});
      if(step===6)return respond(res,step,'search_source',{query:'count'});
      const evidence=[{path:'src/world.js',observation:'The source declares the repeated workload count.'}];
      return respond(res,step,'submit_investigation',{hypothesis:'Inspect repeated resource construction.',objective:'Measure a reduction in real CPU submission overhead.',evidence,relevantFiles:step===7?['src/main.js']:['src/world.js']});
    }, async()=>{
      const result=await investigateProject({...p,onEvent:async e=>events.push(e)});
      assert.equal(result.budget.rounds,8);
      assert.equal(result.evidence[0].sha256.length,64);
      assert.ok(events.some(e=>e.type==='agent-tool-result'&&e.status==='rejected'));
    });
  } finally { await fs.rm(p.workspace,{recursive:true,force:true}); }
});
