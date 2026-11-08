import express from "express";
import {createHostedAccess} from "./hosted-access.mjs";
import {receiveProjectZip,assertManagedUploadPath} from "./project-upload.mjs";
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
import { investigateSpatial, listFindings, spatialRevision, findingScreenshot, spatialProviderStatus } from "./spatial.mjs";
import { receiveStlImport, getStlImport, stlImportDirectory, markStlConnected } from "./stl/imports.mjs";
import {getRepairData,createRepairPlan,createGapRepairPlan,createRepairCandidate,getRepairCandidate,getRepairPlan,candidateFile,repairDirectory} from './stl/repairs.mjs';
import {runRepairAgent} from './stl/repair-agent.mjs';
import { publicFetchAgentStatus } from "./fetch-bridge.mjs";
import { provider, redactProviderError } from "./model.mjs";
import { captureFrame } from "./capture.mjs";
import { discoverProject } from "./discovery.mjs";
import { workerStatus, projectUpdate } from "./jobs.mjs";
import { labState, startLabRun, getLabRun, stopLabRun, getSkill, labRunDir } from "./skills/service.mjs";
dotenv.config({ path: path.join(ROOT, ".env.local"), quiet: true });
await initialize();
const app = express();
app.disable("x-powered-by");
const port = Number(process.env.PORT) || 4310;
let captureBusy = false;
const access = createHostedAccess({port});
app.use(access.middleware);
app.use(express.json({ limit: "1mb" }));
access.installSession(app);
app.post("/api/uploads/project",async(req,res)=>{
  if(!req.is("application/zip"))return res.status(415).json({error:"Project upload requires application/zip"});
  if(activeRun()||captureBusy)throw Error("Wait for the active job before importing another project.");
  const controller=new AbortController();const abort=()=>{if(!res.writableEnded)controller.abort();};res.on("close",abort);
  let filename=String(req.get("X-Upload-Name")||"project.zip");try{filename=decodeURIComponent(filename);}catch{}
  try{res.json(await receiveProjectZip(req,{dataDirectory:DATA,filename,contentLength:req.get("content-length")==null?undefined:Number(req.get("content-length")),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(120000)])}));}finally{res.off("close",abort);}
});
app.post(["/api/inspect","/api/projects"],async(req,res,next)=>{
  if(access.hosted){try{await assertManagedUploadPath(req.body.path,DATA);}catch(error){return next(error);}}
  next();
});
app.use("/api", async (req, res, next) => {
  try {
    await initialize();
    next();
  } catch (e) {
    next(e);
  }
});
app.post("/api/stl/import",async(req,res)=>{
  if(!req.is('application/octet-stream'))return res.status(415).json({error:'STL upload requires application/octet-stream'});
  if(captureBusy||activeRun()||(await labState()).runs.some(r=>['queued','running'].includes(r.status)))throw Error('Wait for the active job before importing a robot.');
  captureBusy=true;const controller=new AbortController();const abort=()=>{if(!res.writableEnded)controller.abort();};res.on('close',abort);
  try {res.json({import:await receiveStlImport(req,{filename:req.query.filename,units:req.query.units,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(360000)])})});}
  finally {captureBusy=false;res.off('close',abort);}
});
app.get('/api/stl/imports/:id',async(req,res)=>res.json({import:await getStlImport(req.params.id)}));
app.get('/api/stl/imports/:id/repair-data',async(req,res)=>res.json(await getRepairData(req.params.id)));
app.get('/api/stl/imports/:id/repair-assets/positions.bin',async(req,res)=>{
 await getRepairData(req.params.id);res.sendFile(path.join(repairDirectory(req.params.id),'overview','overview-positions.bin'),{dotfiles:'allow'});
});
app.post('/api/stl/imports/:id/repair-plan',async(req,res)=>res.json({plan:await createRepairPlan(req.params.id,req.body)}));
app.post('/api/stl/imports/:id/repair-gap-plan',async(req,res)=>res.json({plan:await createGapRepairPlan(req.params.id,req.body)}));
app.post('/api/stl/imports/:id/repair-agent',async(req,res)=>res.json(await runRepairAgent(req.params.id,req.body)));
app.post('/api/stl/imports/:id/repair-candidates',async(req,res)=>{
 if(captureBusy||activeRun())throw Error('Wait for the active job before exporting the full mesh.');captureBusy=true;
 try{res.json({candidate:await createRepairCandidate(req.params.id,req.body)});}finally{captureBusy=false;}
});
app.get('/api/stl/imports/:id/repair-candidates/:candidateId',async(req,res)=>{const candidate=await getRepairCandidate(req.params.id,req.params.candidateId);res.json({candidate,plan:await getRepairPlan(req.params.id,candidate.planId)});});
app.get('/api/stl/imports/:id/repair-candidates/:candidateId/download',async(req,res)=>res.download(await candidateFile(req.params.id,req.params.candidateId),'earl-aligned-candidate.stl',{dotfiles:'allow'}));
app.get('/api/stl/imports/:id/repair-candidates/:candidateId/preview.bin',async(req,res)=>res.sendFile(path.join(path.dirname(await candidateFile(req.params.id,req.params.candidateId)),'preview','overview-positions.bin'),{dotfiles:'allow'}));
app.get('/api/stl/imports/:id/:file',async(req,res)=>{
  if(!['original.stl','repaired.stl'].includes(req.params.file))return res.sendStatus(404);
  const record=await getStlImport(req.params.id);
  if(req.params.file==='repaired.stl'&&record.status!=='review')throw Error('A repaired file is not available for this import.');
  res.download(path.join(stlImportDirectory(record.id),req.params.file),req.params.file,{dotfiles:'allow'});
});
app.post('/api/stl/imports/:id/connect',async(req,res)=>{
  if(req.body.useRepaired!==true)throw Error('Review the repair report and explicitly choose Open repaired model.');
  if(captureBusy||activeRun())throw Error('Wait for the active job before opening this robot.');
  captureBusy=true;
  try {
  const record=await getStlImport(req.params.id);if(record.status!=='review')throw Error('This STL did not produce a repairable viewer.');
  let project=record.projectId?projects.find(p=>p.id===record.projectId&&!p.archived):null;
  if(!project){project=await connect(path.join(stlImportDirectory(record.id),'viewer'),{name:'STL · '+record.filename});project.stlImport={id:record.id,filename:record.filename,units:record.units,report:record.report,originalDownloadUrl:record.originalDownloadUrl,repairedDownloadUrl:record.repairedDownloadUrl,reportUrl:record.reportUrl};await projectUpdate(project);await markStlConnected(record.id,project.id);}
  const run=project.built||req.body.mode==='repair'?null:await start(project.id,'profile',1,'Establish the approved STL mesh baseline');res.json({project,run});
  } finally {captureBusy=false;}
});
app.use('/stl-preview/:id',async(req,res,next)=>{
  const record=await getStlImport(req.params.id);if(record.status!=='review')return res.status(404).send('STL preview is not ready');
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'");express.static(path.join(stlImportDirectory(record.id),'viewer','dist'))(req,res,next);
});
app.get("/api/state", async (req, res) => {
  const lab = await labState();
  const publicAgent = await publicFetchAgentStatus();
  const liveLab = lab.runs.find((r) => r.id === lab.activeRun);
  const labProxy = liveLab ? { ...liveLab, kind: "skill-lab", projectId: null, projectName: "Skill Lab", experiments: [] } : null;
  return res.json({
    projects: projects
      .filter((p) => !p.archived)
      .map(({ originalHashes, ...p }) => p),
    runs: labProxy ? [labProxy, ...runs] : runs,
    activeRun: activeRun() || lab.activeRun,
    provider: provider(),
    spatialProvider: spatialProviderStatus(),
    specialists: { enabled: process.env.EARL_SPONSOR_MODE === "1", meta: Boolean(process.env.MODEL_API_KEY), subquadratic: Boolean(process.env.SUBQ_API_KEY), fetch: "local-uagents", agentverse: publicAgent.status, publicAgent },
    root: ROOT,
    worker: {
      ...(await workerStatus()),
      queue: runs.filter((r) => r.status === "queued").length,
    },
  });
});
app.get("/api/lab", async (req, res) => res.json(await labState()));
app.post("/api/lab/runs", async (req, res) => {
  if (captureBusy) throw Error("Wait for the frame capture to finish before starting the lab.");
  res.json(await startLabRun(req.body));
});
app.get("/api/lab/runs/:id", async (req, res) => {
  const run = await getLabRun(req.params.id);
  if (!run) return res.status(404).json({ error: "Skill-lab run not found" });
  res.json(run);
});
app.post("/api/lab/runs/:id/stop", async (req, res) => res.json(await stopLabRun(req.params.id)));
app.get("/api/lab/skills/:id", async (req, res) => {
  const skill = await getSkill(req.params.id);
  if (!skill) return res.status(404).json({ error: "Skill version not found" });
  res.json(skill);
});
app.get("/api/lab/runs/:id/artifact", async (req, res) => {
  const run = await getLabRun(req.params.id);
  if (!run) return res.sendStatus(404);
  const name = String(req.query.path || "");
  if (!/^[\w/.-]+\.png$/.test(name) || name.split("/").some((p) => p === ".." || p.startsWith(".")))
    return res.sendStatus(404);
  const file = await safeFile(labRunDir(run.id), name);
  res.sendFile(file, { dotfiles: "allow" });
});
app.use("/lab", express.static(path.join(ROOT, "lab", "ui"), { index: "index.html", etag: false, maxAge: 0 }));
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
  if (req.body.trusted !== true)
    throw Error("Confirm that you trust this project and its build command");
  res.json(await connect(req.body.path, { name: req.body.name }));
});
app.post("/api/examples/:name", async (req, res) => {
  if (!["warehouse", "fleet", "assembly", "relay", "orbit-lab"].includes(req.params.name))
    throw Error("Unknown example");
  const existing = projects.find(
    (p) =>
      p.example && p.spatialVersion === "spatial-v1" && p.original === path.join(ROOT, "examples", req.params.name),
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
  if (req.body.kind === "challenge") throw Error("Use the selection challenge endpoint.");
  res.json(await start(req.params.id, req.body.kind, req.body.count, req.body.mission, {findingId:req.body.findingId,sceneContext:req.body.sceneContext}));
});
// Spatial APIs accept selected scene context; they never accept filesystem paths.
app.get("/api/projects/:id/findings", async (req,res) => {
  const p=projects.find(p=>p.id===req.params.id);if(!p)return res.sendStatus(404);
  res.json(await listFindings(p));
});
app.get("/api/projects/:id/findings/:finding/screenshot",async(req,res)=>{
  const p=projects.find(p=>p.id===req.params.id);if(!p)return res.sendStatus(404);
  res.sendFile(findingScreenshot(p,req.params.finding),{dotfiles:'allow'});
});
app.post("/api/projects/:id/findings", async (req,res) => {
  const p=projects.find(p=>p.id===req.params.id);if(!p)return res.sendStatus(404);
  if(!p.built)throw Error("Profile this project before investigating a scene selection.");
  if(captureBusy || activeRun() || (await labState()).activeRun)throw Error("Wait for the current measurement or investigation to finish.");
  captureBusy=true;const controller=new AbortController();const abort=()=>{if(!res.writableEnded)controller.abort();};res.on('close',abort);
  const activity=async(event)=>{p.spatialActivity={...event,updatedAt:new Date().toISOString()};await projectUpdate(p);};
  try {
    await activity({status:'investigating',message:'Capturing selected scene and validating its identity'});
    const finding=await investigateSpatial(p,{goal:req.body.goal,context:req.body.context,provider:req.body.provider},AbortSignal.any([controller.signal,AbortSignal.timeout(180000)]),{onEvent:event=>activity({status:'investigating',provider:event.provider,tool:event.tool,message:event.message})});
    await activity({status:'ready',provider:finding.provider,message:'Source-backed finding ready'});res.json({finding});
  } catch(error){await activity({status:'failed',message:redactProviderError(error.message)});throw error;}
  finally {captureBusy=false;res.off('close',abort);}
});
app.get("/api/projects/:id/challenges", async (req,res) => {
  const p=projects.find(p=>p.id===req.params.id);if(!p)return res.sendStatus(404);
  const revision=await spatialRevision(p);
  res.json({challenges:runs.filter(r=>r.projectId===p.id&&r.kind==='challenge').map(r=>({id:r.id,runId:r.id,status:r.challengeResult?.status||r.status,error:r.error,expectedSelection:r.challenge?.expectedSelection,result:r.challengeResult,stale:r.sourceRevision!==revision,sourceRevision:r.sourceRevision,createdAt:r.createdAt,images:r.challengeResult?{reference:`/api/runs/${r.id}/challenge-image/challenge-reference.png`,candidate:`/api/runs/${r.id}/challenge-image/challenge-candidate.png`}:null}))});
});
app.post("/api/projects/:id/challenges", async (req,res) => {
  if(captureBusy)throw Error("Wait for the current investigation to finish.");
  const p=projects.find(p=>p.id===req.params.id);if(!p)return res.sendStatus(404);
  if(!p.built)throw Error("Build this project before recording a challenge.");
  const run=await start(p.id,'challenge',1,'Verify recorded object selection',{challenge:req.body});
  res.json({challenge:{id:run.id,runId:run.id,status:run.status,expectedSelection:run.challenge.expectedSelection}});
});
app.get("/api/runs/:id/challenge-image/:file", async(req,res)=>{
  const r=runs.find(r=>r.id===req.params.id&&r.kind==='challenge');if(!r||!['challenge-reference.png','challenge-candidate.png'].includes(req.params.file))return res.sendStatus(404);
  res.sendFile(await safeFile(runDir(r),req.params.file),{dotfiles:'allow'});
});
app.use("/candidate/:run/:exp", async(req,res,next)=>{
  const run=runs.find(r=>r.id===req.params.run);const exp=run?.experiments.find(e=>e.id===req.params.exp);const p=projects.find(p=>p.id===run?.projectId);
  if(!p||!exp?.previewReady)return res.status(404).send("Candidate has not built yet");
  const root=exp.status==='accepted'&&p.lastAcceptedExperiment===exp.id?path.join(projectDir(p),'best',p.config.outputDir||'dist'):path.join(runDir(run),exp.id,'workspace',p.config.outputDir||'dist');
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'");
  express.static(root)(req,res,next);
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
  if(activeRun()||captureBusy)throw Error("Wait for verification to finish before Apply.");
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
  if (provider().name === "meta") throw Error("Sponsor mode is configured in .env.local. Update MODEL_API_KEY or META_MODEL there, or disable EARL_SPONSOR_MODE to use custom model settings.");
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
  const existingEnv = dotenv.parse(await fs.readFile(path.join(ROOT, ".env.local"), "utf8").catch(() => ""));
  const replaced = new Set(lines.map((line) => line.split("=")[0]));
  const retained = Object.entries(existingEnv).filter(([key]) => !replaced.has(key)).map(([key, value]) => key + "=" + JSON.stringify(value));
  await fs.writeFile(path.join(ROOT, ".env.local"), [...retained, ...lines].join("\n") + "\n", {
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
  if (activeRun() || (await labState()).runs.some((r) => ["queued", "running"].includes(r.status)))
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
app.get('/repair',(req,res,next)=>process.env.NODE_ENV==='production'?res.sendFile(path.join(ROOT,'dist','index.html')):next());
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
  console.error(redactProviderError(err.message));
  res
    .status(Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 400)
    .json({ error: redactProviderError(err.message) });
});
const bindHost = access.hosted ? "0.0.0.0" : "127.0.0.1";
app.listen(port, bindHost, () =>
  console.log(`Sift ready at ${access.publicOrigin || `http://127.0.0.1:${port}`}`),
);
