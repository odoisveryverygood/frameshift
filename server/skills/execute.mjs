/** Untrusted transformer executor. Runs only in a separate restricted process. */
import fs from "node:fs/promises";
import vm from "node:vm";

const [inputPath, outputPath] = process.argv.slice(2);
try {
  const input = JSON.parse(await fs.readFile(inputPath, "utf8"));
  if (typeof input.code !== "string" || input.code.length > 100000)
    throw Error("Skill code must be at most 100 KB");
  // No host functions or host objects are exposed to generated code. Only a
  // primitive JSON string crosses into the context; parsing happens inside it.
  const context = vm.createContext(Object.assign(Object.create(null), {
    __sourceJSON: JSON.stringify(input.files),
  }), {
    codeGeneration: { strings: false, wasm: false },
    microtaskMode: "afterEvaluate",
  });
  const script = new vm.Script(`"use strict";\n${input.code}\n;JSON.stringify(transform(JSON.parse(__sourceJSON)));`, {
    filename: "generated-skill.js",
  });
  const output = script.runInContext(context, { timeout: 1500, breakOnSigint: true });
  if (typeof output !== "string" || output.length > 3000000)
    throw Error("Skill returned no valid bounded JSON result");
  JSON.parse(output);
  await fs.writeFile(outputPath, output, { flag: "wx", mode: 0o600 });
} catch (error) {
  console.error("Skill execution failed: " + String(error.message).slice(0, 1200));
  process.exitCode = 1;
}
