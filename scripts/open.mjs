#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export function parseOptions(args, cwd = process.cwd()) {
  let project;
  let port = Number(process.env.PORT || 4310);
  let browser = true;
  let fresh = false;
  let help = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--no-browser") browser = false;
    else if (arg === "--fresh") fresh = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--port") {
      const value = args[++i];
      if (!/^\d+$/.test(value || ""))
        throw Error("--port requires a port number.");
      port = Number(value);
    } else if (arg.startsWith("-")) throw Error(`Unknown option: ${arg}`);
    else if (project !== undefined) throw Error("Pass one project folder.");
    else project = arg;
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error("Port must be between 1 and 65535.");
  return {
    project: path.resolve(cwd, project || "."),
    port,
    browser,
    fresh,
    help,
  };
}

async function request(origin, route, body, timeout = 5000) {
  const response = await fetch(origin + route, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeout),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw Error(data?.error || `Earl returned HTTP ${response.status}.`);
  if (!data) throw Error("The local service did not return an Earl response.");
  return data;
}

async function state(origin) {
  try {
    const data = await request(origin, "/api/state", undefined, 1500);
    if (data.root !== ROOT || !Array.isArray(data.projects))
      throw Error(
        `Another service is using ${origin}. Choose a different --port.`,
      );
    return data;
  } catch (error) {
    if (error.cause?.code === "ECONNREFUSED") return null;
    throw error;
  }
}

async function ensureServer(origin, port) {
  const running = await state(origin);
  if (running) return running;
  const directory = path.join(ROOT, ".frameshift");
  await fs.mkdir(directory, { recursive: true });
  const logPath = path.join(directory, "web.log");
  const log = await fs.open(logPath, "a", 0o600);
  let failed;
  let exited = false;
  let child;
  try {
    child = spawn(process.execPath, [path.join(ROOT, "scripts/start.mjs")], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(port) },
      detached: true,
      stdio: ["ignore", log.fd, log.fd],
    });
    child.on("error", (error) => {
      failed = error;
    });
    child.on("exit", () => {
      exited = true;
    });
    child.unref();
  } finally {
    await log.close();
  }
  for (let i = 0; i < 80; i++) {
    if (failed) throw failed;
    if (exited) throw Error(`Earl could not start. See ${logPath}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const ready = await state(origin);
    if (ready) return ready;
  }
  // Stop this attempt rather than leaving a web server that unexpectedly appears later.
  child.kill("SIGTERM");
  throw Error(`Earl did not become ready within 20 seconds. See ${logPath}`);
}

async function openBrowser(url) {
  const command =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  await new Promise((resolve) => {
    const child = spawn(command[0], command[1], {
      stdio: "ignore",
      detached: true,
    });
    child.on("error", resolve);
    child.on("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

async function ensureWorker(current, origin) {
  if (current.worker?.alive) return;
  const directory = path.join(ROOT, ".frameshift");
  await fs.mkdir(directory, { recursive: true });
  const logPath = path.join(directory, "worker.log");
  const log = await fs.open(logPath, "a", 0o600);
  let failed;
  try {
    const child = spawn(
      process.execPath,
      [path.join(ROOT, "server/worker.mjs")],
      {
        cwd: ROOT,
        env: process.env,
        detached: true,
        stdio: ["ignore", log.fd, log.fd],
      },
    );
    child.on("error", (error) => {
      failed = error;
    });
    child.unref();
  } finally {
    await log.close();
  }
  for (let i = 0; i < 20; i++) {
    if (failed) throw failed;
    await new Promise((resolve) => setTimeout(resolve, 250));
    const ready = await state(origin);
    if (ready?.worker?.alive) return;
  }
  throw Error(`The Earl worker is unavailable. See ${logPath}`);
}

export async function main(args = process.argv.slice(2), cwd = process.cwd()) {
  const options = parseOptions(args, cwd);
  if (options.help) {
    console.log(
      "Usage: npm run open -- [project-folder] [--fresh] [--no-browser] [--port 4310]\nConnects a trusted local Vite + Three.js project to Earl. No source upload.\nWhen no folder is given, connects the current directory.\nUse --fresh to import a new snapshot after editing source outside Earl.",
    );
    return;
  }
  const projectPath = await fs.realpath(options.project).catch(() => {
    throw Error(`Project folder does not exist: ${options.project}`);
  });
  if (!(await fs.stat(projectPath)).isDirectory())
    throw Error("Choose a project folder.");
  await fs.access(path.join(projectPath, "package.json")).catch(() => {
    throw Error("Choose a project folder containing package.json.");
  });
  const origin = `http://127.0.0.1:${options.port}`;
  console.log(`Connecting local project: ${projectPath}`);
  const current = await ensureServer(origin, options.port);
  await ensureWorker(current, origin);
  const existing =
    !options.fresh &&
    current.projects.find((project) => project.original === projectPath);
  if (existing)
    console.log(
      "Reopening the connected snapshot. Use --fresh to import external source changes.",
    );
  const project =
    existing ||
    (await request(
      origin,
      "/api/projects",
      {
        path: projectPath,
        trusted: true,
      },
      180000,
    ));
  const url = `${origin}/?project=${encodeURIComponent(project.id)}`;
  console.log(
    `\nEarl is ready: ${url}\nSource stays local. Earl works in a separate copy; applying a patch is explicit.\nYour connected project may execute its build scripts when you run an experiment.`,
  );
  if (options.browser) await openBrowser(url);
  return { projectId: project.id, url };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(`Earl: ${error.message}`);
    process.exitCode = 1;
  });
}
