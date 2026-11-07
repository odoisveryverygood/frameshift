import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { ROOT, DATA, json, within, safeFile, save } from "./core.mjs";
import {
  initialize,
  projects,
  runs,
  connect,
  start,
  stop,
  activeRun,
  projectDir,
  runDir,
  exportPatch,
  apply,
  events,
  resume,
} from "./runner.mjs";
import { provider } from "./model.mjs";
import { captureFrame } from "./capture.mjs";
import { discoverProject } from "./discovery.mjs";
import { workerStatus, projectUpdate } from "./jobs.mjs";
dotenv.config({ path: path.join(ROOT, ".env.local"), quiet: true });
await initialize();
const app = express();
app.disable("x-powered-by");
const port = Number(process.env.PORT) || 4310;
let captureBusy = false;
app.use((req, res, next) => {
  const host = req.headers.host?.split(":")[0];
  if (!["127.0.0.1", "localhost", "[::1]"].includes(host))
    return res.status(403).json({ error: "Local access only" });
  if (
    req.headers.origin &&
    !["http://127.0.0.1:" + port, "http://localhost:" + port].includes(
      req.headers.origin,
    ) &&
    !(
      req.method === "GET" &&
      /^\/(preview|baseline)\//.test(req.path) &&
      req.headers.origin === "null"
    )
  )
    return res.status(403).json({ error: "Cross-origin requests denied" });
  if (
    req.path.startsWith("/api/") &&
    !["GET", "HEAD"].includes(req.method) &&
    !req.is("application/json")
  )
    return res.status(415).json({ error: "JSON requests required" });
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});
app.use(express.json({ limit: "1mb" }));
app.use("/api", async (req, res, next) => {
  try {
    await initialize();
    next();
  } catch (e) {
    next(e);
  }
});
app.get("/api/state", async (req, res) =>
  res.json({
    projects: projects
      .filter((p) => !p.archived)
      .map(({ originalHashes, ...p }) => p),
    runs,
    activeRun: activeRun(),
    provider: provider(),
    root: ROOT,
    worker: {
      ...(await workerStatus()),
      queue: runs.filter((r) => r.status === "queued").length,
    },
  }),
);
app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.flushHeaders();
  const push = () => res.write("data: update\n\n");
  events.on("update", push);
  const timer = setInterval(push, 1000);
  req.on("close", () => {
    events.off("update", push);
    clearInterval(timer);
  });
});
app.post("/api/inspect", async (req, res) =>
  res.json(await discoverProject(req.body.path)),
);
app.post("/api/runs/:id/resume", async (req, res) =>
  res.json(await resume(req.params.id)),
);
app.post("/api/projects", async (req, res) => {
  if (!req.body.trusted)
    throw Error("Confirm that you trust this project and its build command");
  res.json(await connect(req.body.path, { name: req.body.name }));
});
app.post("/api/examples/:name", async (req, res) => {
  if (!["warehouse", "fleet", "assembly"].includes(req.params.name))
    throw Error("Unknown example");
  const existing = projects.find(
    (p) =>
      p.example && p.original === path.join(ROOT, "examples", req.params.name),
  );
  res.json(
    existing ||
      (await connect(path.join(ROOT, "examples", req.params.name), {
        example: true,
      })),
  );
});
app.post("/api/projects/:id/archive", async (req, res) => {
  if (activeRun()) throw Error("Finish the active run first");
  const p = projects.find((p) => p.id === req.params.id);
  if (!p) return res.sendStatus(404);
  p.archived = true;
  await projectUpdate(p);
  res.json({ archived: true, historyRetained: true });
});
app.post("/api/projects/:id/runs", async (req, res) => {
  if (captureBusy) throw Error("Wait for frame capture to finish");
  res.json(await start(req.params.id, req.body.kind, req.body.count, req.body.mission));
});
app.post("/api/stop", async (req, res) =>
  res.json({ id: await stop(req.body.runId) }),
);
app.get("/api/projects/:id/source", async (req, res) => {
  const p = projects.find((p) => p.id === req.params.id);
  if (!p) return res.sendStatus(404);
  const name = String(req.query.path || "");
  const allowed = new Set([
    ...(p.config.editableFiles || []),
    ...(p.discovery?.files || []).map((f) => f.path),
  ]);
  if (
    !allowed.has(name) ||
    !name.match(/\.[cm]?[jt]sx?$/) ||
    name.split("/").some((x) => x === ".." || x.startsWith(".env"))
  )
    throw Error("Source path is protected");
  const file = await safeFile(path.join(projectDir(p), "best"), name);
  const stat = await fs.stat(file);
  if (stat.size > 240000) throw Error("Source exceeds preview limit");
  res.json({
    path: name,
    content: await fs.readFile(file, "utf8"),
    imports: p.discovery?.files?.find((f) => f.path === name)?.imports || [],
  });
});
app.post("/api/projects/:id/scenario", async (req, res) => {
  const p = projects.find((p) => p.id === req.params.id);
  if (!p) return res.sendStatus(404);
  if (
    runs.some(
      (r) =>
        r.projectId === p.id &&
        ["queued", "running", "recovering"].includes(r.status),
    )
  )
    throw Error("Wait for this project’s job before changing its replay");
  const allowed = [
    "click",
    "pointerdown",
    "pointerup",
    "pointermove",
    "keydown",
    "keyup",
    "wheel",
  ];
  const input = req.body.events;
  if (!Array.isArray(input) || input.length > 80)
    throw Error("A replay supports up to 80 events");
  const events = input
    .map((e) => {
      if (!allowed.includes(e.type)) throw Error("Unsupported replay event");
      const result = {
        type: e.type,
        at: Math.max(0, Math.min(60, Number(e.at) || 0)),
      };
      if (e.type.startsWith("key")) {
        if (
          typeof e.key !== "string" ||
          !(
            /^[a-zA-Z0-9 ]$/.test(e.key) ||
            [
              "ArrowUp",
              "ArrowDown",
              "ArrowLeft",
              "ArrowRight",
              "Enter",
              "Escape",
              "Space",
              "Shift",
              "Control",
              "Alt",
            ].includes(e.key)
          )
        )
          throw Error("Unsupported replay key");
        result.key = e.key === " " ? "Space" : e.key;
      } else {
        result.x = Math.max(0, Math.min(1, Number(e.x) || 0));
        result.y = Math.max(0, Math.min(1, Number(e.y) || 0));
        if (e.type === "wheel")
          result.deltaY = Math.max(
            -1000,
            Math.min(1000, Number(e.deltaY) || 0),
          );
      }
      return result;
    })
    .sort((a, b) => a.at - b.at);
  p.config.scenario = {
    name: String(req.body.name || "Recorded interaction replay").slice(0, 100),
    events,
    savedAt: new Date().toISOString(),
  };
  await projectUpdate(p);
  res.json(p.config.scenario);
});
app.get("/api/projects/:id/patch", async (req, res) => {
  const p = projects.find((p) => p.id === req.params.id);
  if (!p) return res.sendStatus(404);
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="earl.patch"',
  );
  res.type("text/plain").send(await exportPatch(p));
});
app.post("/api/projects/:id/apply", async (req, res) => {
  const p = projects.find((p) => p.id === req.params.id);
  if (!p) return res.sendStatus(404);
  res.json(await apply(p));
});
app.get("/api/runs/:id/report", async (req, res) => {
  const run = runs.find((r) => r.id === req.params.id);
  if (!run) return res.sendStatus(404);
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="earl-report.json"',
  );
  res.json({
    ...run,
    measurementNotes: [
      "Local headless Chrome at 960×640, DPR 1",
      "Selected goal: " + (run.metric || "submitP95"),
      "CPU update+render submission time is not GPU utilization",
      "One machine; no physical phone validation",
      "Visual and semantic guards cover configured views and interactions, not all application behavior",
    ],
  });
});
app.get("/api/runs/:id/experiments/:exp/verdict", async (req, res) => {
  const run = runs.find((r) => r.id === req.params.id);
  if (!run || !run.experiments.some((e) => e.id === req.params.exp))
    return res.status(404).json({ error: "Experiment not found" });
  try {
    const file = await safeFile(path.join(runDir(run), req.params.exp), "verdict.json");
    res.setHeader("Cache-Control", "no-store");
    res.json(await json(file));
  } catch (error) {
    if (error.code === "ENOENT")
      return res.status(404).json({ error: "No verification receipt exists for this experiment yet" });
    throw error;
  }
});
app.get("/api/runs/:id/baseline/:file", async (req, res) => {
  if (!/^baseline-[0-7]\.png$/.test(req.params.file)) return res.sendStatus(404);
  const run = runs.find((r) => r.id === req.params.id);
  if (!run) return res.sendStatus(404);
  try {
    const file = await safeFile(runDir(run), req.params.file);
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(file, { dotfiles: "allow" });
  } catch (error) {
    if (error.code === "ENOENT") return res.sendStatus(404);
    throw error;
  }
});
app.get("/api/runs/:id/artifacts/:exp/:file", async (req, res) => {
  if (!/^[\w-]+\.png$/.test(req.params.file)) return res.sendStatus(404);
  const r = runs.find((r) => r.id === req.params.id);
  if (!r || !r.experiments.some((e) => e.id === req.params.exp))
    return res.sendStatus(404);
  res.sendFile(
    await safeFile(path.join(runDir(r), req.params.exp), req.params.file),
    { dotfiles: "allow" },
  );
});
app.use("/preview/:id", async (req, res, next) => {
  const p = projects.find((p) => p.id === req.params.id);
  if (!p?.built)
    return res.status(404).send("Run a profile to build the preview");
  const root = path.join(projectDir(p), "best", p.config.outputDir || "dist");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'",
  );
  express.static(root)(req, res, next);
});
app.use("/baseline/:id", async (req, res, next) => {
  const p = projects.find((p) => p.id === req.params.id);
  if (!p) return res.sendStatus(404);
  const root = path.join(projectDir(p), "original-build");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'",
  );
  express.static(root)(req, res, next);
});
app.post("/api/settings", async (req, res) => {
  if (activeRun())
    throw Error("Stop the current run before changing provider settings");
  const { model, baseUrl, apiKey, protocol = "responses" } = req.body;
  if (!["responses", "chat-completions"].includes(protocol))
    throw Error("Unsupported API protocol");
  const url = new URL(baseUrl || "https://api.openai.com/v1");
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname)
    )
  )
    throw Error("Use an HTTPS provider URL or a local endpoint");
  if (!/^[\w./:-]{1,150}$/.test(model || "")) throw Error("Invalid model name");
  if (apiKey && (/[\r\n]/.test(apiKey) || apiKey.length > 500))
    throw Error("Invalid API key");
  if (apiKey) process.env.OPENAI_API_KEY = apiKey;
  process.env.LLM_API_PROTOCOL = protocol;
  process.env.OPENAI_MODEL = model;
  process.env.OPENAI_BASE_URL = url.toString().replace(/\/$/, "");
  const lines = [
    "OPENAI_API_KEY=" + JSON.stringify(process.env.OPENAI_API_KEY || ""),
    "OPENAI_MODEL=" + JSON.stringify(model),
    "OPENAI_BASE_URL=" + JSON.stringify(process.env.OPENAI_BASE_URL),
    "LLM_API_PROTOCOL=" + protocol,
    "PORT=" + port,
  ];
  await fs.writeFile(path.join(ROOT, ".env.local"), lines.join("\n") + "\n", {
    mode: 0o600,
  });
  await fs.chmod(path.join(ROOT, ".env.local"), 0o600);
  res.json(provider());
});
app.get("/api/help", async (req, res) =>
  res
    .type("text/markdown")
    .send(await fs.readFile(path.join(ROOT, "ADAPTER.md"), "utf8")),
);
app.post("/api/projects/:id/capture", async (req, res) => {
  if (activeRun())
    throw Error(
      "Wait for the benchmark to finish before instrumenting a frame",
    );
  const p = projects.find((p) => p.id === req.params.id);
  if (!p?.built) throw Error("Profile this project first");
  const capturePath = path.join(projectDir(p), "frame-capture.json.gz");
  if (captureBusy) throw Error("A frame capture is already running");
  captureBusy = true;
  try {
    const result = await captureFrame(
      path.join(projectDir(p), "best", p.config.outputDir || "dist"),
      capturePath,
      AbortSignal.timeout(40000),
    );
    res.json(result);
  } finally {
    captureBusy = false;
  }
});
app.get("/api/projects/:id/capture", async (req, res) => {
  const p = projects.find((p) => p.id === req.params.id);
  if (!p) return res.sendStatus(404);
  res.download(
    path.join(projectDir(p), "frame-capture.json.gz"),
    "frameshift-webgl-capture.json.gz",
  );
});
app.get("/api/compatibility", async (req, res) =>
  res.json({
    supported: "Local Vite + Three.js WebGL projects with automatic integration; configured adapters also supported",
    gpuTiming:
      "Optional EXT_disjoint_timer_query_webgl2 GPU queries, when supplied by the adapter",
    engineProbe:
      "vendor/probe-engine.mjs; run from a project with Three.js installed",
    limitations: [
      "Builds run as your user. Workspace copies provide rollback isolation, not an OS security sandbox.",
      "Only connect trusted local projects.",
      "OpenAI Responses-compatible provider required.",
    ],
  }),
);
app.use("/api", (req, res) =>
  res.status(404).json({ error: "API endpoint not found" }),
);
if (process.env.NODE_ENV === "production")
  app.use(express.static(path.join(ROOT, "dist")));
else {
  const vite = await createViteServer({
    root: ROOT,
    worker: {
      ...(await workerStatus()),
      queue: runs.filter((r) => r.status === "queued").length,
    },
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
app.use((err, req, res, next) => {
  console.error(String(err.message).replace(/sk-[\w-]+/g, "[redacted]"));
  res
    .status(400)
    .json({ error: String(err.message).replace(/sk-[\w-]+/g, "[redacted]") });
});
app.listen(port, "127.0.0.1", () =>
  console.log(`Earl ready at http://127.0.0.1:${port}`),
);
