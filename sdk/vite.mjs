import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const sdkPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "runtime.mjs",
);
export function frameShiftPlugin({ onInstrument = () => {} } = {}) {
  let count = 0;
  return {
    name: "frameshift-observer",
    enforce: "pre",
    resolveId(id) {
      if (id === "virtual:frameshift-runtime") return "\0frameshift-runtime";
    },
    async load(id) {
      if (id === "\0frameshift-runtime")
        return await fs.readFile(sdkPath, "utf8");
    },
    transform(code, id) {
      if (
        !/three(?:\/|\\).*three(?:\.module)?(?:\.min)?\.js(?:\?|$)/.test(id) ||
        !code.includes("WebGLRenderer")
      )
        return null;
      const match = /export\s*\{([^{}]+)\}\s*;?\s*$/.exec(code);
      if (!match || !/(?:^|,)\s*WebGLRenderer\s*(?:,|$)/.test(match[1]))
        return null;
      const list = match[1].replace(
        /\bWebGLRenderer\b/,
        "__FrameShiftRenderer as WebGLRenderer",
      );
      const injected = `\nconst __FrameShiftRenderer=new Proxy(WebGLRenderer,{construct(target,args,newTarget){const renderer=Reflect.construct(target,args,newTarget);__observeFrameShift(renderer);return renderer;}});\nexport {${list}};\n`;
      count++;
      onInstrument(id);
      return {
        code:
          `import {observeRenderer as __observeFrameShift} from 'virtual:frameshift-runtime';\n` +
          code.slice(0, match.index) +
          injected,
        map: null,
      };
    },
    closeBundle() {
      if (!count)
        throw new Error(
          "FrameShift could not locate the installed Three.js WebGLRenderer export. Confirm the application uses Three.js WebGL and the installed engine build is supported.",
        );
    },
  };
}
