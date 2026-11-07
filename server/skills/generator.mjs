/** Generate a reusable executable skill from training evidence only. */
import { provider, providerApiKey } from "../model.mjs";
import { normalizeSkillPath } from "./runtime.mjs";

const redact = (value) => String(value).replace(/sk-[\w-]+/g, "[redacted]");
const schema = {
  type: "object", additionalProperties: false,
  properties: { name: { type: "string" }, description: { type: "string" }, code: { type: "string" } },
  required: ["name", "description", "code"],
};
const instructions = `You are Earl's optimization-skill researcher. Produce a REUSABLE executable source transformer learned from the training application and its measured failures. Return JSON with name, description, code. code must define a synchronous function transform(files), where files is an object mapping relative source paths to source strings. It returns {files:[{path,content}],notes}, where notes MUST be a string. Include only changed source modules. Return files:[] when prerequisites do not match; never fabricate a successful application.

The transformer must inspect and transform input source at application time. Do not emit a single fixed replacement file, hardcode the training file path, source hash, object count, geometry, layout, color, animation constants, or project identity. Derive these from the input. Its purpose is transferable optimization, not lookup of a fixture. Implement a conservative family of THREE.js repeated opaque Mesh->InstancedMesh transformations. String/regex and small balanced-brace parsers are available; no imports or third-party parsers are available inside the transformer. JSON, string, array, object, RegExp and Math built-ins are available. No process, require, filesystem, network, timers, async functions, eval or Function construction. The only inputs are source text and allowed relative paths. Iterate Object.entries(files) to find suitable modules. Geometry compatibility must compare actual attribute/index array values and render groups, not just type, counts, constructor parameters or a subset of vertices: geometry can be scaled or otherwise mutated after construction. Training includes geometry-variation and nested-parent stress cases derived solely from the training source; their source is provided as training-cases modules. Invisible original meshes still exist in the semantic scene graph; detach batched originals from the graph and preserve their update references externally rather than merely setting visible=false. Detached original objects lose their parent. For batches sharing an original parent, call each original object's updateMatrix() and use its LOCAL matrix in the batch; do not treat its detached matrixWorld as its former world transform. Keep the batch under the original parent so moving ancestors are preserved. Do not patch raycast unless needed: standard InstancedMesh hits include instanceId and the application maps userData.semanticIds to original identities.

Preserve every object, geometry, material, name/semanticId, animation formula, transform, and selection identity. For instancing group equal geometry+opaque material and preserve per-instance names/semanticIds in userData.semanticIds as appropriate. Raycast selection of an InstancedMesh must map hit.instanceId back to original identity. Keep each instance matrix equal to the original world transform, and mark instanceMatrix.needsUpdate when animation changes. Preserve bounds and frustum behavior. Never remove an object's rendered workload, reduce resolution, freeze motion, skip objects, falsify draw statistics, inspect webdriver/benchmark mode, introduce profiler references, or change the rendering/test harness. Avoid unsupported transparent materials. Never edit package/build/test/SDK files. A safe limited applicability scope is acceptable: return no changes for unsupported source shapes.

For factory modules exporting createWorld(THREE, scene) and returning an update(t) method, a useful reusable strategy is to preserve the original factory source and wrap it: rename that original factory, call it, inspect created meshes at initialization, batch compatible opaque repeated meshes sharing a parent, retain original mesh references for the existing update method, and have the wrapper update copy their updated local matrices to instance slots. The transformation should preserve other returned factory methods/properties. This avoids rewriting animation formulas. Do not retain individual meshes in the rendered scene after batching, but do retain the ordinary objects for the original update references. Preserve nested moving parent groups. Recognize materials by render-relevant properties rather than unique material UUIDs; geometries by actual compatible shape/attributes rather than geometry UUIDs. Unsupported shapes/materials must remain untouched. Stable semantic identities must come from the original userData.semanticId or mesh.name, not newly invented order-dependent names. Missing bounds or a stale InstancedMesh sphere can affect visibility; conservatively disable frustum culling for a batch when necessary. Keep scope conservative and avoid name collisions in injected helper identifiers.

Use the exact incoming expressions/strings to preserve constants and semantics; derive rendering code from them. Recognize THREE aliases and variable names conservatively; do not guess. Reuse allocations where possible. Skills are evaluated first on training, then separately on unseen applications. No evaluation-project source or results are available to you. You cannot claim transfer success: only the evaluator can establish it. Previous failed TRAINING feedback is evidence to repair the reusable transformer. Return code only inside the JSON code string, without Markdown.`;

export function trainingContext({ trainingFiles, feedback = [], parentSkill } = {}) {
  if (!trainingFiles || typeof trainingFiles !== "object" || Array.isArray(trainingFiles))
    throw Error("Training source files are required");
  const files = {};
  let total = 0;
  for (const [name, content] of Object.entries(trainingFiles)) {
    normalizeSkillPath(name);
    if (typeof content !== "string" || content.length > 240000) throw Error("Invalid training source");
    total += content.length;
    if (total > 400000 || Object.keys(files).length >= 40) throw Error("Training context exceeds its source budget");
    files[name] = content;
  }
  if (!Object.keys(files).length) throw Error("Training source files are required");
  if (!Array.isArray(feedback)) throw Error("Training feedback must be an array");
  const safeFeedback = feedback.slice(-8).map((item) => {
    if (!item || typeof item !== "object" || (item.split && item.split !== "training"))
      throw Error("Skill generation accepts training feedback only");
    const allowed = {};
    for (const key of ["status", "stage", "reason", "error", "notes"])
      if (typeof item[key] === "string") allowed[key] = redact(item[key]).slice(0, 5000);
    for (const key of ["metrics", "guards"])
      if (item[key] && typeof item[key] === "object") {
        const text = JSON.stringify(item[key]);
        if (text.length > 12000) throw Error("Training feedback exceeds the evidence budget");
        allowed[key] = JSON.parse(redact(text));
      }
    return { split: "training", ...allowed };
  });
  const parent = parentSkill ? {
    name: String(parentSkill.name || "").slice(0, 120),
    description: String(parentSkill.description || "").slice(0, 4000),
    code: typeof parentSkill.code === "string" ? parentSkill.code.slice(0, 100000) : "",
  } : null;
  return { split: "training", trainingFiles: files, feedback: safeFeedback, parentSkill: parent };
}

export async function generateSkill({ trainingFiles, feedback, parentSkill, signal, onEvent = () => {} } = {}) {
  const context = trainingContext({ trainingFiles, feedback, parentSkill });
  const config = provider();
  if (!config.configured) throw Error("Configure a model provider before generating a skill");
  const combined = AbortSignal.any([signal, AbortSignal.timeout(240000)].filter(Boolean));
  combined.throwIfAborted();
  await onEvent({ type: "skill-generation", message: "Generating an executable skill using training source only", model: config.model });
  const payload = config.protocol === "chat-completions" ? {
    model: config.model,
    messages: [{ role: "system", content: instructions }, { role: "user", content: JSON.stringify(context) }],
    max_tokens: 12000, response_format: { type: "json_object" },
  } : {
    model: config.model, instructions, input: JSON.stringify(context), max_output_tokens: 12000,
    text: { format: { type: "json_schema", name: "earl_executable_skill", strict: true, schema } },
  };
  let response, body;
  try {
    response = await fetch(config.baseUrl.replace(/\/$/, "") + (config.protocol === "chat-completions" ? "/chat/completions" : "/responses"), {
      method: "POST", headers: { Authorization: "Bearer " + providerApiKey(), "Content-Type": "application/json" },
      body: JSON.stringify(payload), signal: combined,
    });
    body = await response.json();
  } catch (error) {
    throw Error(combined.aborted ? (signal?.aborted ? "Skill generation stopped" : "Skill generation timed out") : "Skill provider request failed: " + redact(error.message).slice(0, 500));
  }
  if (!response.ok)
    throw Error(`Skill provider failed (${response.status}): ${redact(body?.error?.message || "Provider rejected the request").slice(0, 1000)}`);
  const output = config.protocol === "chat-completions" ? body.choices?.[0]?.message?.content :
    body.output?.filter((item) => item.type === "message").flatMap((item) => item.content || []).filter((part) => part.type === "output_text").map((part) => part.text).join("");
  let skill;
  try { skill = JSON.parse(output); } catch { throw Error("Skill provider returned invalid JSON; no skill was created"); }
  if (!skill || typeof skill.name !== "string" || !skill.name.trim() || skill.name.length > 120 ||
      typeof skill.description !== "string" || skill.description.length > 4000 ||
      typeof skill.code !== "string" || skill.code.length < 20 || skill.code.length > 100000 ||
      !/\btransform\s*(?:\(|=)/.test(skill.code))
    throw Error("Skill provider returned an invalid executable skill");
  await onEvent({ type: "skill-generated", message: "Executable candidate generated; transfer is not yet evaluated", model: config.model });
  return { name: skill.name.trim(), description: skill.description, code: skill.code, model: config.model, usage: body.usage || {} };
}
