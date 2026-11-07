#!/usr/bin/env node
import fs from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverProject } from "../server/discovery.mjs";

export function parseOptions(args, cwd = process.cwd()) {
  let folder;
  let json = false;
  let help = false;
  for (const arg of args) {
    if (arg === "--json") json = true;
    else if (["--help", "-h"].includes(arg)) help = true;
    else if (arg.startsWith("-"))
      throw Error("Unknown doctor option. Use --help.");
    else if (folder !== undefined) throw Error("Pass one project folder.");
    else folder = arg.trim();
  }
  if (folder === "") throw Error("Pass a nonempty project folder.");
  return { folder: path.resolve(cwd, folder ?? "."), json, help };
}

// Check executable files only: diagnosis never launches Chrome or project code.
export async function findChrome({
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
} = {}) {
  const names =
    platform === "win32"
      ? ["chrome.exe"]
      : ["google-chrome", "google-chrome-stable", "chrome"];
  const candidates =
    platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          path.join(
            home,
            "Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          ),
        ]
      : platform === "win32"
        ? [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA]
            .filter(Boolean)
            .map((base) =>
              path.join(base, "Google/Chrome/Application/chrome.exe"),
            )
        : ["/opt/google/chrome/chrome"];
  candidates.push(
    ...(env.PATH || "")
      .split(platform === "win32" ? ";" : path.delimiter)
      .filter(Boolean)
      .flatMap((dir) => names.map((name) => path.join(dir, name))),
  );
  for (const candidate of candidates) {
    try {
      if (!(await fs.stat(candidate)).isFile()) continue;
      await fs.access(
        candidate,
        platform === "win32" ? constants.F_OK : constants.X_OK,
      );
      return candidate;
    } catch {
      /* Try the next standard installation location. */
    }
  }
  return null;
}

async function installedPackage(root, name) {
  // Mirrors Node's ancestor node_modules lookup without importing package code.
  if (!/^(?:@[\w.-]+\/)?[\w.-]+$/.test(name)) return null;
  for (let current = root; ; current = path.dirname(current)) {
    try {
      const pkg = JSON.parse(
        await fs.readFile(
          path.join(current, "node_modules", name, "package.json"),
          "utf8",
        ),
      );
      if (pkg && typeof pkg === "object" && typeof pkg.version === "string")
        return pkg;
    } catch {
      /* Missing or incomplete installation. */
    }
    if (path.dirname(current) === current) return null;
  }
}

const remediations = {
  THREE_NOT_FOUND:
    "Choose a Vite application that declares Three.js in package.json.",
  NEXT_REQUIRES_ADAPTER:
    "Use a standalone Vite + Three.js WebGL harness; Next.js automatic execution is unsupported.",
  BUILD_SYSTEM_UNSUPPORTED:
    "Use a Vite + Three.js WebGL application for automatic profiling.",
  WEBGPU_UNSUPPORTED:
    "Use WebGLRenderer; automatic WebGPU profiling is unsupported.",
  BUILD_SCRIPT_MISSING:
    'Add a production build script, for example "build": "vite build".',
  ENTRY_NOT_IDENTIFIED:
    "Check index.html's module script and run doctor from the application root.",
  SCAN_LIMIT:
    "Use a smaller application root or remove generated source from the application tree.",
};

export async function diagnoseProject(
  folder,
  { nodeVersion = process.versions.node, chrome = findChrome } = {},
) {
  const findings = [];
  const add = (code, severity, message, remediation = "") =>
    findings.push({ code, severity, message, remediation });
  const nodeReady =
    /^\d+\.\d+\.\d+/.test(nodeVersion) &&
    Number(nodeVersion.split(".")[0]) >= 22;
  add(
    nodeReady ? "NODE_READY" : "NODE_UNSUPPORTED",
    nodeReady ? "info" : "error",
    `Node.js ${nodeVersion}; Earl requires Node.js 22 or newer.`,
    nodeReady ? "" : "Install Node.js 22 or newer, then rerun doctor.",
  );
  const chromePath = await chrome();
  add(
    chromePath ? "CHROME_READY" : "CHROME_MISSING",
    chromePath ? "info" : "error",
    chromePath
      ? "Google Chrome is available."
      : "Google Chrome was not found in a standard installation location or PATH.",
    chromePath
      ? ""
      : "Install Google Chrome in its default location or put its executable on PATH. Earl uses Playwright's chrome channel.",
  );
  let discovery;
  let threeVersion = null;
  try {
    discovery = await discoverProject(folder);
  } catch (error) {
    const known = new Set([
      "FOLDER_REQUIRED",
      "FOLDER_NOT_FOUND",
      "FOLDER_NOT_DIRECTORY",
      "PACKAGE_MISSING",
      "PACKAGE_INVALID",
      "CONFIG_INVALID",
    ]);
    const code = known.has(error.code) ? error.code : "PROJECT_UNREADABLE";
    add(
      code,
      "error",
      known.has(error.code) ? error.message : "The project could not be read.",
      "Choose a readable application folder with a valid package.json and configuration; check folder permissions.",
    );
  }
  if (discovery) {
    add(
      "PROJECT_VALID",
      "info",
      "Project folder and package.json are readable.",
    );
    add(
      discovery.supported ? "FRAMEWORK_READY" : "FRAMEWORK_UNSUPPORTED",
      discovery.supported ? "info" : "error",
      `${discovery.framework}; automatic support covers Vite + Three.js WebGL.`,
      discovery.supported ? "" : remediations.BUILD_SYSTEM_UNSUPPORTED,
    );
    for (const issue of discovery.issues) {
      if (issue.code === "DEPENDENCIES_NOT_INSTALLED") continue;
      add(
        issue.code,
        issue.severity,
        issue.message,
        remediations[issue.code] || "Review this finding before profiling.",
      );
    }
    if (discovery.entryPoints.length)
      add(
        "ENTRY_READY",
        "info",
        `Identified ${discovery.entryPoints.length} entry module(s).`,
      );
    if (discovery.scripts.build?.trim())
      add(
        "BUILD_SCRIPT_READY",
        "info",
        "A production build script is declared; it has not been executed.",
      );
    const missing = [];
    for (const name of Object.keys(discovery.dependencies)) {
      if (!(await installedPackage(discovery.root, name))) missing.push(name);
    }
    add(
      missing.length ? "DEPENDENCIES_MISSING" : "DEPENDENCIES_READY",
      missing.length ? "error" : "info",
      missing.length
        ? `${missing.length} declared package(s) are missing or incomplete.`
        : "Declared dependencies are installed (including development/build dependencies).",
      missing.length
        ? "In the project folder, run npm ci when a package-lock.json exists, otherwise npm install. Include development dependencies, then rerun doctor."
        : "",
    );
    const three = await installedPackage(discovery.root, "three");
    const version = three?.version;
    const parts = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version || "");
    if (parts) threeVersion = version;
    const supportedVersion =
      parts && (Number(parts[1]) > 0 || Number(parts[2]) >= 150);
    add(
      !version
        ? "THREE_NOT_INSTALLED"
        : supportedVersion
          ? "THREE_VERSION_READY"
          : "THREE_VERSION_UNSUPPORTED",
      supportedVersion ? "info" : "error",
      !version
        ? "An installed Three.js version could not be read."
        : parts
          ? `Installed Three.js ${version}; the observer requires >=0.150.0.`
          : "The installed Three.js version is not a recognized semantic version.",
      supportedVersion
        ? ""
        : "Install the project's dependencies and use Three.js >=0.150.0 with WebGLRenderer.",
    );
  }
  return {
    schemaVersion: 1,
    ready: !findings.some((finding) => finding.severity === "error"),
    project: discovery
      ? {
          name: discovery.name,
          framework: discovery.framework,
          threeVersion,
          entryPoints: discovery.entryPoints,
        }
      : null,
    findings,
    limits: [
      "Read-only prerequisite checks; no build, browser launch, model request, or package installation.",
      "Does not prove build success, WebGL availability, dependency version compatibility, or profiler instrumentation. Run the live smoke check next.",
    ],
  };
}

export async function main(args = process.argv.slice(2), cwd = process.cwd()) {
  let options;
  try {
    options = parseOptions(args, cwd);
  } catch (error) {
    const report = {
      schemaVersion: 1,
      ready: false,
      project: null,
      findings: [
        {
          code: "CLI_USAGE",
          severity: "error",
          message: error.message,
          remediation: "Use node scripts/doctor.mjs --help.",
        },
      ],
    };
    console.log(
      args.includes("--json")
        ? JSON.stringify(report, null, 2)
        : `BLOCKED: ${error.message}`,
    );
    return 1;
  }
  if (options.help) {
    console.log(
      "Usage: node scripts/doctor.mjs [project-folder] [--json]\nRead-only readiness checks. Defaults to the current folder. Exit 0: ready (possibly with warnings); exit 1: blocked.\nDoes not execute package scripts, install dependencies, launch browsers, or call a model.",
    );
    return 0;
  }
  const report = await diagnoseProject(options.folder);
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Earl project doctor: ${report.ready ? "READY" : "BLOCKED"}`);
    for (const finding of report.findings) {
      console.log(
        `[${finding.severity.toUpperCase()}] ${finding.code}: ${finding.message}`,
      );
      if (finding.remediation) console.log(`  Next: ${finding.remediation}`);
    }
    for (const limit of report.limits) console.log(limit);
  }
  return report.ready ? 0 : 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      console.error(
        "Earl doctor could not complete its read-only checks. Check filesystem permissions and rerun.",
      );
      process.exitCode = 1;
    });
}
