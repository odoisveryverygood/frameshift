import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { propose } from "../server/model.mjs";
test("provider transports send bounded patch requests and reject malformed responses", async () => {
  let protocol = "responses";
  let malformed = false;
  const proposal = {
    title: "Reuse geometry",
    hypothesis: "Reduce duplicate buffers",
    expectedEffect: "Less overhead",
    files: [{ path: "src/scene.js", content: "export const x=1;" }],
    notes: "Test fixture",
  };
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const data = JSON.parse(body);
    assert.equal(req.headers.authorization, "Bearer test-key");
    assert.equal(data.model, "test-model");
    assert.ok(JSON.stringify(data).includes("src/scene.js"));
    res.setHeader("Content-Type", "application/json");
    const content = JSON.stringify(malformed ? { files: "bad" } : proposal);
    res.end(
      JSON.stringify(
        protocol === "responses"
          ? {
              id: "test-response",
              output: [
                {
                  type: "message",
                  content: [{ type: "output_text", text: content }],
                },
              ],
              usage: { total_tokens: 10 },
            }
          : {
              id: "test-chat",
              choices: [{ message: { content } }],
              usage: { total_tokens: 10 },
            },
      ),
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const before = { ...process.env };
  try {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_MODEL = "test-model";
    process.env.OPENAI_BASE_URL = "http://127.0.0.1:" + server.address().port;
    const args = {
      sources: { "src/scene.js": "export const x=0;" },
      metrics: { calls: 1000 },
      history: [],
      config: { editableFiles: ["src/scene.js"] },
      signal: new AbortController().signal,
    };
    for (const p of ["responses", "chat-completions"]) {
      protocol = p;
      process.env.LLM_API_PROTOCOL = p;
      const r = await propose(args);
      assert.deepEqual(r.files, proposal.files);
      assert.equal(r.usage.total_tokens, 10);
    }
    malformed = true;
    await assert.rejects(() => propose(args), /schema/);
  } finally {
    for (const key of [
      "OPENAI_API_KEY",
      "OPENAI_MODEL",
      "OPENAI_BASE_URL",
      "LLM_API_PROTOCOL",
    ]) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
    await new Promise((r) => server.close(r));
  }
});
