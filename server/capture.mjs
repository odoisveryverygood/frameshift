import path from "node:path";
import fs from "node:fs/promises";
import {gzipSync} from "node:zlib";
import { ROOT } from "./core.mjs";
import { withPage } from "./benchmark.mjs";
export async function captureFrame(directory, target, signal) {
  return withPage(directory, signal, async (page) => {
    await page.evaluate(() => window.__frameshift.pause?.());
    await page.addScriptTag({
      path: path.join(ROOT, "node_modules/spectorjs/dist/spector.bundle.js"),
    });

    const result = await page.evaluate(async () => {
      const spector = new SPECTOR.Spector();
      spector.spyCanvases();
      return await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(Error("WebGL capture timed out")),
          20000,
        );
        spector.onCapture.add((capture) => {
          clearTimeout(timeout);
          resolve(capture);
        });
        spector.onError.add((error) => {
          clearTimeout(timeout);
          reject(Error(String(error)));
        });
        spector.captureCanvas(document.querySelector("canvas"), 0, true);
        requestAnimationFrame(() => window.__frameshift.step(0, 0));
      });
    });
    if (!result.commands?.some((c) => /^draw/.test(c.name)))
      throw Error("No draw commands captured; frame capture is incomplete");
    const compressed=gzipSync(JSON.stringify(result));
      await fs.writeFile(target,compressed);
    return {
      commands: result.commands?.length ?? 0,
      drawCommands:
        result.commands?.filter((c) => /^draw/.test(c.name)).length ?? 0,
      capturedAt: new Date().toISOString(),
      instrumented: true,
        compressedBytes:compressed.length,
      note: "Instrumented Spector.js frame capture; not a timing benchmark",
    };
  });
}
