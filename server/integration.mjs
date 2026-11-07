import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, loadConfigFromFile, mergeConfig } from "vite";
import { frameShiftPlugin } from "../sdk/vite.mjs";
export { frameShiftPlugin };
export async function buildInstrumented(
  workspace,
  config,
  { signal, onLog = () => {} } = {},
) {
  if (signal?.aborted) throw new Error("Run stopped");
  const loaded = await loadConfigFromFile(
    { command: "build", mode: "production" },
    undefined,
    workspace,
  );
  const actual = mergeConfig(loaded?.config || {}, {
    root: workspace,
    base: "./",
    configFile: false,
    plugins: [
      ...((loaded?.config.plugins || [])
        .flat(Infinity)
        .some((p) => p?.name === "frameshift-observer")
        ? []
        : [
            frameShiftPlugin({
              onInstrument: (id) => onLog("Instrumented " + path.basename(id)),
            }),
          ]),
    ],
    build: { outDir: config.outputDir || "dist", emptyOutDir: true },
    logLevel: "warn",
  });
  await build(actual);
  if (signal?.aborted) throw new Error("Run stopped");
  return path.resolve(workspace, config.outputDir || "dist");
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const workspace = path.resolve(process.argv[2] || process.cwd());
  const config = JSON.parse(await fs.readFile(process.argv[3], "utf8"));
  await buildInstrumented(workspace, config, {
    onLog: (line) => process.stdout.write(line + "\n"),
  });
}
