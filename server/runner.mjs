import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createTwoFilesPatch } from "diff";
import { EventEmitter } from "node:events";
import { transformWithEsbuild } from "vite";
import {
  ROOT,
  DATA,
  id,
  json,
  save,
  within,
  safeFile,
  copyProject,
  dependencies,
  command,
  experimentStrategy,
  assertVerificationContinuation,
} from "./core.mjs";
import { measure, measurePair, capture, verify } from "./benchmark.mjs";
import { provider } from "./model.mjs";
import { investigateProject } from "./investigator.mjs";
import { assessPatchRisks, verificationConfigForRisks } from "./subq.mjs";
import { createFetchBridge } from "./fetch-bridge.mjs";
import { projectUpdate, promotion } from "./jobs.mjs";
import { discoverProject, resolveProjectFolder } from "./discovery.mjs";
import { buildInstrumented } from "./integration.mjs";
import { proposeExperiment } from "./agent.mjs";
import { normalizeChallenge, runChallenge } from "./challenges.mjs";
import { spatialRevision, getFinding, recordFindingOutcome, investigateSpatial, validateSceneContext } from "./spatial.mjs";
import { normalizeMission } from "./mission.mjs";
import { sealVerificationPolicy, writeVerificationVerdict } from "./verifier.mjs";
export const events = new EventEmitter();
const projectsFile = path.join(DATA, "projects.json");
export let projects = [];
export let runs = [];
let active = null;
const sponsorMode = () => process.env.EARL_SPONSOR_MODE === "1";
async function sourceFingerprint(directory, config) {
  const hashes = {};
  for (const name of [...config.editableFiles].sort()) hashes[name] = digest(await fs.readFile(await safeFile(directory, name)));
  return digest(JSON.stringify(hashes));
}
const digest = (s) => crypto.createHash("sha256").update(s).digest("hex");
export const projectDir = (p) => path.join(DATA, "projects", p.id);
export const runDir = (r) => path.join(DATA, "runs", r.id);
export async function persistRun(run) {
  run.updatedAt = new Date().toISOString();
  await save(path.join(runDir(run), "run.json"), run);
  events.emit("update", run.id);
}
export async function initialize() {
  await fs.mkdir(DATA, { recursive: true });
  const loadedProjects = await json(projectsFile, []);
  const loadedRuns = [];
  await fs.mkdir(path.join(DATA, "runs"), { recursive: true });
  for (const name of await fs.readdir(path.join(DATA, "runs"))) {
    const r = await json(path.join(DATA, "runs", name, "run.json"), null);
    if (r) loadedRuns.push(r);
  }
  projects=loadedProjects;
  runs=loadedRuns.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
export async function connect(source, { example = false, name } = {}) {
  const original = await resolveProjectFolder(source);
  const pkg = await json(path.join(original, "package.json"), null);
  if (!pkg) throw Error("Choose a project folder containing package.json");
  const discovery = await discoverProject(original);
  const existing = await json(
    path.join(original, "frameshift.config.json"),
    null,
  );
  if (!discovery.supported && !existing)
    throw Error(
      discovery.issues
        ?.map((x) => (typeof x === "string" ? x : x.message))
        .join(" ") || "This project is not supported yet.",
    );
  const config = { ...discovery.config, ...existing };
  config.autoInstrument = existing?.autoInstrument ?? !existing;
  config.editableFiles = [
    ...new Set(config.editableFiles || discovery.files.map((f) => f.path)),
  ];
  if (!config.editableFiles.length || config.editableFiles.length > 180)
    throw Error("Select 1–180 source modules.");
  if (!Array.isArray(config.buildCommand) || !config.buildCommand.length)
    throw Error("A production build command is required.");
  config.metric = "submitP95";
  config.samples = Math.max(30, Math.min(160, Number(config.samples) || 60));
  config.repeats = Math.max(3, Math.min(5, Number(config.repeats) || 3));
  config.minImprovement = Math.max(0.05, Number(config.minImprovement) || 0.08);
  config.maxVisualDifference = Math.min(
    0.02,
    Number(config.maxVisualDifference) || 0.01,
  );
  for (const file of config.editableFiles) {
    if (
      !/^[\w./-]+\.[cm]?[jt]sx?$/.test(file) ||
      file.split("/").includes("..") ||
      file
        .split("/")
        .some(
          (x) =>
            ["node_modules", ".git", ".frameshift", "dist"].includes(x) ||
            x.startsWith(".env"),
        )
    )
      throw Error("Only application source modules can be edited.");
    await safeFile(original, file);
  }
  if (
    !/^[\w/-]+$/.test(config.outputDir || "dist") ||
    (config.outputDir || "dist").split("/").includes("..")
  )
    throw Error("Invalid build output directory");
  config.checkpoints = config.checkpoints || [
    { time: 0, view: 0 },
    { time: 0.6, view: 1 },
    { time: 1.2, view: 2 },
    { time: 2, view: 0 },
    { time: 3, view: 1 },
    { time: 4.2, view: 2 },
    { time: 5, view: 0 },
    { time: 6, view: 1 },
  ];
  const project = {
    id: id(),
    name: name || config.name || pkg.name,
    original,
    discovery,
    example,
    spatialVersion: config.autoInstrument || await fs.stat(path.join(original,"src/earl-spatial.js")).catch(()=>null) ? "spatial-v1" : null,
    config,
    createdAt: new Date().toISOString(),
    originalHashes: {},
  };
  await copyProject(original, path.join(projectDir(project), "best"));
  await dependencies(path.join(projectDir(project), "best"), original);
  for (const file of config.editableFiles)
    project.originalHashes[file] = digest(
      await fs.readFile(path.join(original, file)),
    );
  projects.unshift(project);
  projects = await projectUpdate(project);
  return project;
}
async function build(workspace, project, run) {
  await log(run, "build", "Building production bundle");
  await dependencies(workspace, project.original);
  run.isolation =
    process.platform === "darwin"
      ? "macOS filesystem-restricted, network-denied builds"
      : "Sanitized process environment; OS sandbox unavailable";
  await command(project.config.buildCommand, workspace, {
    isolate: true,
    signal: active.controller.signal,
    onLog: (line) => {
      run.buildLog = (run.buildLog || "") + line;
      run.buildLog = run.buildLog.slice(-10000);
    },
  });
  if (project.config.autoInstrument) {
    await log(run, "build", "Attaching the protected Three.js profiler");
    const settings = path.join(
      workspace,
      ".frameshift-build",
      "integration.json",
    );
    await save(settings, project.config);
    await command(
      [
        process.execPath,
        path.join(ROOT, "server", "instrument-build.mjs"),
        workspace,
        settings,
      ],
      workspace,
      {
        signal: active.controller.signal,
        isolate: true,
        onLog: (line) => {
          run.buildLog = ((run.buildLog || "") + line).slice(-16000);
        },
      },
    );
  }
  const out = within(workspace, project.config.outputDir || "dist");
  await safeFile(
    workspace,
    path.relative(workspace, path.join(out, "index.html")),
  );
  return out;
}
async function log(run, type, message) {
  run.events.push({ at: new Date().toISOString(), type, message });
  run.phase = message;
  await persistRun(run);
}
export async function start(projectId, kind = "profile", count = 2, mission = "", details = {}) {
  mission = normalizeMission(mission);
  await initialize();
  const project = projects.find((p) => p.id === projectId);
  if (!project) throw Error("Project not found");
  if (project.config.previewOnly && kind !== 'profile')
    throw Error('This project is a sampled large-STL overview. Full-file cleanup is available in the import report; optimizing or verifying the overview cannot certify the full robot.');
  if (!["profile", "optimize", "guard-check", "challenge"].includes(kind))
    throw Error("Invalid run type");
  if (
    runs.some(
      (r) =>
        r.projectId === projectId &&
        ["queued", "running", "recovering"].includes(r.status),
    )
  )
    throw Error("This project already has a queued or running job");
  if (
    runs.filter((r) => ["queued", "running", "recovering"].includes(r.status))
      .length >= 8
  )
    throw Error("Queue is full");
  if(details.findingId) await getFinding(project,details.findingId);
  const run = {
    id: id(),
    projectId,
    projectName: project.name,
    mission,
    kind,
    status: "queued",
    createdAt: new Date().toISOString(),
    phase: "Waiting for the local worker",
    events: [],
    experiments: [],
    config: structuredClone(project.config),
    maxExperiments: sponsorMode() ? 1 : Math.max(1, Math.min(5, Number(count) || 2)),
    sponsorMode: sponsorMode(),
    ...(details.challenge ? { challenge: normalizeChallenge(details.challenge), sourceRevision: await spatialRevision(project) } : {}),
    ...(details.findingId ? { findingId: details.findingId } : {}),
    ...(details.sceneContext ? { sceneContext: validateSceneContext(details.sceneContext) } : {}),
    tokens: 0,
    recoveries: 0,
  };
  runs.unshift(run);
  await persistRun(run);
  return run;
}
export async function processJob(run) {
  await initialize();
  const project = projects.find((p) => p.id === run.projectId);
  if (!project) throw Error("Project no longer exists");
  active = { runId: run.id, controller: new AbortController() };
  run.status = "running";
  run.workerPid = process.pid;
  run.startedAt = run.startedAt || new Date().toISOString();
  await persistRun(run);
  const cancel = path.join(runDir(run), "cancel.json");
  const timer = setInterval(async () => {
    if (await fs.stat(cancel).catch(() => null)) {
      active.stopReason = "user";
      active.controller.abort();
    }
  }, 350);
  const deadline = setTimeout(
    () => {
      active.stopReason = "timeout";
      active.controller.abort();
    },
    20 * 60 * 1000,
  );
  try {
    if (await fs.stat(cancel).catch(() => null)) throw Error("Run stopped");
    if (run.kind === "challenge") {
      if (!run.challenge) throw Error("Challenge contract missing");
      const revision = await spatialRevision(project);
      if (revision !== run.sourceRevision) throw Error("Project changed after this challenge was recorded. Record it again.");
      await log(run, "challenge", "Verifier: replaying your selection challenge against original and current workspace");
      const result = await runChallenge({referenceDirectory:path.join(projectDir(project), "original-build"),candidateDirectory:path.join(projectDir(project),"best",project.config.outputDir||"dist"),challenge:run.challenge,evidenceDir:runDir(run),signal:active.controller.signal});
      if (await spatialRevision(project) !== revision) throw Error("Project source changed during challenge verification");
      run.challengeResult = {...result, sourceRevision:revision};
      run.status = "completed";
      await log(run, "challenge", `Selection challenge ${result.status}: reference ${result.observed.reference ?? "none"}, candidate ${result.observed.candidate ?? "none"}`);
    } else await execute(project, run);
  } catch (e) {
    run.status =
      active.controller.signal.aborted ||
      (await fs.stat(cancel).catch(() => null))
        ? active.stopReason === "timeout"
          ? "failed"
          : "stopped"
        : "failed";
    run.error = String(e.message).replace(/(?:sk[-_]|LLM_)[\w-]+/g, "[redacted]");
    for (const exp of run.experiments)
      if (
        !["accepted", "rejected", "inconclusive", "interrupted"].includes(
          exp.status,
        )
      ) {
        exp.status = run.status;
        exp.reason = run.error;
      }
    await log(
      run,
      "error",
      run.status === "stopped"
        ? "Stopped. The last accepted workspace was preserved."
        : run.error,
    );
  } finally {
    clearInterval(timer);
    clearTimeout(deadline);
    await active.fetchBridge?.close();
    if(run.findingId) {
      const exp=run.experiments.at(-1);
      await recordFindingOutcome(project,run.findingId,{runId:run.id,experimentId:exp?.id,status:exp?.status||run.status,reason:exp?.reason||run.error}).catch(()=>{run.historyWarning="Could not update the investigation history; inspect the saved run report.";});
    }
    active = null;
    await persistRun(run);
  }
}
async function execute(project, run) {
  const signal = active.controller.signal;
  const best = path.join(projectDir(project), "best");
  if (project.config.autoInstrument) {
    const sdkVersion = digest(
      await fs.readFile(path.join(ROOT, "sdk", "runtime.mjs")),
    );
    if (project.sdkVersion !== sdkVersion) {
      const originalSource = path.join(projectDir(project), "original-source");
      if (!(await fs.stat(originalSource).catch(() => null))) {
        for (const file of project.config.editableFiles) {
          if (
            digest(
              await fs.readFile(await safeFile(project.original, file)),
            ) !== project.originalHashes[file]
          )
            throw Error(
              "Original project changed before profiler migration. Reconnect it to establish a new reference.",
            );
        }
        await copyProject(project.original, originalSource);
        await dependencies(originalSource, project.original);
      }
      const golden = await build(originalSource, project, run);
      const destination = path.join(projectDir(project), "original-build");
      await fs.cp(golden, destination, { recursive: true, force: true });
      project.sdkVersion = sdkVersion;
      projects = await projectUpdate(project);
      run.checkpoints = {};
      run.sdkVersion = sdkVersion;
    }
  }
  let directory = within(best, project.config.outputDir || "dist");
  let baselineCapture = await json(
    path.join(runDir(run), "baseline-states.json"),
    null,
  );
  if (
    run.checkpoints?.baseline &&
    run.baseline &&
    baselineCapture &&
    (await fs.stat(path.join(directory, "index.html")).catch(() => null))
  ) {
    run.best = run.best || run.baseline;
    await log(
      run,
      "recovery",
      "Continuing from the completed baseline checkpoint",
    );
  } else {
    directory = await build(best, project, run);
    if (!project.built) {
      await fs.cp(directory, path.join(projectDir(project), "original-build"), {
        recursive: true,
      });
    }
    project.built = true;
    projects = await projectUpdate(project);
    await log(run, "profile", "Profiling the reference on this machine");
    const base = await measure(directory, project.config, signal);
    run.baseline = base.summary;
    await save(path.join(runDir(run), "baseline.json"), base);
    baselineCapture = await capture(
      directory,
      runDir(run),
      "baseline",
      signal,
      project.config,
    );
    await save(path.join(runDir(run), "baseline-states.json"), baselineCapture);
    run.metric =
      run.kind === "optimize" && base.summary.calls > 500
        ? "drawCalls"
        : "submitP95";
    run.best = base.summary;
    await persistRun(run);
    run.checkpoints = { ...(run.checkpoints || {}), baseline: true };
    await persistRun(run);
  }
  if (run.kind === "profile") {
    run.status = "completed";
    await log(run, "complete", project.config.previewOnly ? "Overview measured. Full-model optimization is unavailable for this sampled preview." : "Baseline captured. Ready to optimize.");
    return;
  }
  if (run.kind === "guard-check") {
    await log(
      run,
      "verify",
      "Guard demonstration: testing a deliberately broken variant",
    );
    const exp = {
      id: id(),
      index: 1,
      title: "Guard demonstration — missing objects",
      hypothesis:
        "Verify that removing objects is rejected even when it reduces render work.",
      status: "checking",
      kind: "deliberate negative control",
    };
    run.experiments.push(exp);
    const dir = path.join(runDir(run), exp.id);
    await fs.mkdir(dir, { recursive: true });
    await capture(directory, dir, "reference", signal, project.config);
    const broken = {
      states: baselineCapture.states.map((s) => ({
        ...s,
        items: s.items.slice(1),
      })),
      errors: [],
      interaction: baselineCapture.interaction,
    };
    for (let i = 0; i < baselineCapture.states.length; i++)
      await fs.copyFile(
        path.join(dir, `reference-${i}.png`),
        path.join(dir, `candidate-${i}.png`),
      );
    const ref = await json(path.join(runDir(run), "baseline-states.json"));
    exp.guards = await verify(ref, broken, dir, project.config);
    exp.status = exp.guards.pass ? "failed" : "rejected";
    exp.reason =
      "Deliberately removed a semantic object from verifier input; transform/count guard rejected it. This is a verifier negative control, not an AI experiment.";
    run.status = exp.guards.pass ? "failed" : "completed";
    await log(
      run,
      "complete",
      exp.guards.pass
        ? "Guard negative control failed"
        : "Guard negative control rejected the broken state",
    );
    return;
  }
  if (run.sponsorMode) {
    if (!process.env.MODEL_API_KEY || !process.env.SUBQ_API_KEY) throw Error("Sponsor mode requires MODEL_API_KEY and SUBQ_API_KEY. No fallback was used.");
    active.fetchBridge = await createFetchBridge({ signal });
    run.agents = { investigator: "meta", optimizer: "meta", verifier: "subquadratic-risk + deterministic-tests", transport: "local-uagents" };
  }
  const verificationSeal = await sealVerificationPolicy(project.config, run.metric);
  assertVerificationContinuation(run.verifier, verificationSeal.hash);
  run.verifier = { version: 1, policyHash: verificationSeal.hash };
  await persistRun(run);
  const finished = run.experiments.filter((e) =>
    ["accepted", "rejected", "inconclusive"].includes(e.status),
  ).length;
  for (let index = finished + 1; index <= run.maxExperiments; index++) {
    if (signal.aborted) throw Error("Run stopped");
    const exp = {
      id: id(),
      index,
      status: "reasoning",
      createdAt: new Date().toISOString(),
    };
    run.experiments.push(exp);
    await log(
      run,
      "agent",
      `Experiment ${index}: analyzing source and measurements`,
    );
    const sources = {};
    const strategy = experimentStrategy(
      runs
        .filter((r) => r.projectId === project.id)
        .slice()
        .reverse()
        .flatMap((r) => r.experiments),
    );
    await save(path.join(projectDir(project), "strategy.json"), strategy);
    const experimentDir = path.join(runDir(run), exp.id);
    await fs.mkdir(experimentDir, { recursive: true });
    const sourceHash = await sourceFingerprint(best, project.config);
    let investigation;
    const handoff = async (stage, attempt, candidateHash, artifactHash) => {
      if (!active.fetchBridge) return;
      const receipt = await active.fetchBridge.handoff({ stage, jobId: `${run.id}:${exp.id}`, attempt, sourceHash, ...(candidateHash ? { candidateHash } : {}), ...(artifactHash ? { artifactHash } : {}) });
      exp.handoffs = [...(exp.handoffs || []), receipt];
      await save(path.join(experimentDir, "agent-handoffs.json"), exp.handoffs);
      if (stage === "PatchReady") await save(path.join(experimentDir, "verification-request.json"), receipt);
      await persistRun(run);
    };
    if (run.sponsorMode) {
      await log(run, "investigator", "Investigator: inspecting source and measured bottlenecks");
      if (!run.findingId && run.sceneContext) {
        const finding=await investigateSpatial(project,{goal:run.mission||"Investigate the selected scene for a measured, behavior-preserving optimization",context:run.sceneContext},signal);
        run.findingId=finding.id;
      }
      investigation = run.findingId ? await getFinding(project, run.findingId) : await investigateProject({ workspace: best, mission: run.mission, manifest: project.discovery, metrics: run.best, config: { ...project.config, metric: run.metric }, signal,
        onEvent: async (event) => { exp.investigatorTrace = [...(exp.investigatorTrace || []), event]; run.phase = event.message; await persistRun(run); } });
      run.agents.investigator = investigation.provider || "meta";
      run.agents.investigatorModel = investigation.model;
      exp.investigation = investigation;
      await save(path.join(experimentDir, "investigation.json"), investigation);
      await handoff("InvestigationReady", 0);
      await log(run, "optimizer", "Optimizer: implementing one focused change in the isolated candidate");
    }
    const proposal = await proposeExperiment({
      investigation,
      workspace: best,
      mission: run.mission,
      manifest: project.discovery,
      onEvent: async (event) => {
        exp.trace = exp.trace || [];
        exp.trace.push(event);
        run.phase = event.message || event.tool || "Inspecting source";
        await persistRun(run);
      },
      strategy,
      metrics: run.best,
      history: [
        ...runs
          .filter((r) => r.projectId === project.id)
          .flatMap((r) => r.experiments)
          .filter((e) => e.guards?.pass === false)
          .slice(0, 2),
        ...runs
          .filter((r) => r.projectId === project.id && r.id !== run.id)
          .slice(0, 3)
          .reverse()
          .flatMap((r) => r.experiments),
        ...run.experiments.slice(0, -1),
      ]
        .filter((e, i, a) => a.findIndex((x) => x.id === e.id) === i)
        .slice(-12)
        .map((e) => ({
          title: e.title,
          status: e.status,
          reason: e.reason,
          guards: e.guards,
          metrics: e.candidate,
          patch: e.diff?.slice(0, 16000),
        })),
      config: { ...project.config, metric: run.metric },
      signal,
    });
    Object.assign(exp, {
      title: proposal.title,
      hypothesis: proposal.hypothesis,
      expectedEffect: proposal.expectedEffect,
      notes: proposal.notes,
      model: proposal.model,
      usage: proposal.usage,
      trace: proposal.trace || exp.trace,
      patches: proposal.patches,
    });
    run.tokens += proposal.usage?.total_tokens || 0;
    if (!proposal.files.length) {
      exp.agentOutcome = "no-candidate";
      exp.status = "inconclusive";
      exp.reason = proposal.notes || "No further safe change proposed";
      await persistRun(run);
      break;
    }
    if (proposal.files.length > project.config.editableFiles.length)
      throw Error("Model returned too many files");
    const seen = new Set();
    for (const file of proposal.files) {
      if (
        !project.config.editableFiles.includes(file.path) ||
        seen.has(file.path) ||
        typeof file.content !== "string" ||
        file.content.length > 180000
      )
        throw Error("Model attempted an invalid source edit");
      seen.add(file.path);
    }
    for (const file of proposal.files) {
      sources[file.path] = await fs.readFile(
        await safeFile(best, file.path),
        "utf8",
      );
      if (proposal.sourceHashes?.[file.path] !== digest(sources[file.path]))
        throw Error(
          "Source changed after the agent inspected it. Retry this experiment.",
        );
    }
    await save(
      path.join(runDir(run), exp.id, "reference-source.json"),
      sources,
    );
    exp.referenceHashes = Object.fromEntries(
      Object.entries(sources).map(([p, s]) => [p, digest(s)]),
    );
    let meaningful = false;
    for (const file of proposal.files) {
      const opts = {
        loader: file.path.endsWith(".tsx")
          ? "tsx"
          : file.path.endsWith(".ts")
            ? "ts"
            : file.path.endsWith(".jsx")
              ? "jsx"
              : "js",
        minifyWhitespace: true,
        legalComments: "none",
      };
      const a = await transformWithEsbuild(sources[file.path], file.path, opts);
      const b = await transformWithEsbuild(file.content, file.path, opts);
      if (a.code !== b.code) meaningful = true;
    }
    if (!meaningful) {
      exp.status = "inconclusive";
      exp.reason =
        "No executable source change: patch only repeats the current code or changes formatting/comments.";
      await log(
        run,
        "inconclusive",
        `Experiment ${index}: no executable change; benchmark skipped`,
      );
      continue;
    }
    const candidate = path.join(runDir(run), exp.id, "workspace");
    await copyProject(best, candidate);
    await dependencies(candidate, project.original);
    let patch = "";
    for (const file of proposal.files) {
      patch += createTwoFilesPatch(
        "a/" + file.path,
        "b/" + file.path,
        sources[file.path],
        file.content,
      );
      await fs.writeFile(await safeFile(candidate, file.path), file.content);
    }
    exp.files = proposal.files.map((f) => f.path);
    exp.diff = patch;
    await fs.writeFile(path.join(runDir(run), exp.id, "change.patch"), patch);
    exp.status = "building";
    await persistRun(run);
    for (let repairAttempt = 0; repairAttempt < 3; repairAttempt++) {
      let verificationConfig = project.config;
      let candidateSeal = verificationSeal;
      let candidateHash;
      let handedToVerifier = false;
      let handoffCompleted = false;
      let riskReady = !run.sponsorMode;
      try {
        if (repairAttempt) {
          delete exp.guards; delete exp.candidate; delete exp.reference; delete exp.verifier;
          for (const name of ["guards.json", "verdict.json", "reference-metrics.json", "candidate-metrics.json", "measurement-order.json"]) await fs.unlink(path.join(experimentDir, name)).catch(error => { if (error.code !== "ENOENT") throw error; });
        }
        if (run.sponsorMode) {
          if (repairAttempt) await handoff("InvestigationReady", repairAttempt);
          candidateHash = await sourceFingerprint(candidate, project.config);
          await handoff("PatchReady", repairAttempt, candidateHash, digest(exp.diff));
          handedToVerifier = true;
          await log(run, "verifier", "Verifier: assessing patch risks with Subquadratic");
          const assessment = await assessPatchRisks({ sources, patch: exp.diff, contract: { ...project.config, mission: run.mission }, signal });
          verificationConfig = verificationConfigForRisks({ ...project.config, metric: run.metric }, assessment);
          riskReady = true;
          candidateSeal = await sealVerificationPolicy(verificationConfig, run.metric);
          exp.riskAssessment = assessment;
          exp.verificationCheckpoints = verificationConfig.checkpoints;
          await save(path.join(experimentDir, "risk-assessment.json"), assessment);
          await save(path.join(experimentDir, "verification-plan.json"), { config: verificationConfig, seal: candidateSeal });
        }
        const candidateOutput = await build(candidate, project, run);
        exp.previewReady = true;
        exp.previewUrl = `/candidate/${run.id}/${exp.id}/index.html?attempt=${repairAttempt}`;
        exp.previewStatus = "testing";
        await log(run, "candidate-ready", "Runnable candidate built. Testing; not yet verified.");
        exp.status = "verifying";
        await log(
          run,
          "verify",
          `Experiment ${index}: checking visuals, object transforms and picking`,
        );
        const evidence = path.join(runDir(run), exp.id);
        const reference = await capture(
          path.join(projectDir(project), "original-build"),
          evidence,
          "reference",
          signal,
          verificationConfig,
        );
        const candidateCapture = await capture(
          candidateOutput,
          evidence,
          "candidate",
          signal,
          verificationConfig,
          reference,
        );
        await save(path.join(evidence, "reference-states.json"), reference);
        await save(path.join(evidence, "candidate-states.json"), candidateCapture);
        exp.guards = await verify(
          reference,
          candidateCapture,
          evidence,
          verificationConfig,
        );
        await save(path.join(evidence, "guards.json"), exp.guards);
        if (!exp.guards.pass)
          throw Error(
            "Correctness verification failed: " +
              JSON.stringify({
                geometry: exp.guards.geometry,
                checks: exp.guards.checks,
                interactions: exp.guards.interactions,
                errors: exp.guards.errors,
              }),
          );
        exp.status = "benchmarking";
        await log(
          run,
          "benchmark",
          `Experiment ${index}: sequential reference and candidate benchmarks`,
        );
        const pair = await measurePair(
          directory,
          candidateOutput,
          verificationConfig,
          signal,
        );
        const referenceMetrics = pair.reference,
          candidateMetrics = pair.candidate;
        await save(path.join(evidence, "measurement-order.json"), pair.order);
        await save(
          path.join(evidence, "reference-metrics.json"),
          referenceMetrics,
        );
        await save(
          path.join(evidence, "candidate-metrics.json"),
          candidateMetrics,
        );
        exp.reference = referenceMetrics.summary;
        exp.candidate = candidateMetrics.summary;
        Object.assign(
          exp,
          await writeVerificationVerdict({
            seal: candidateSeal,
            config: verificationConfig,
            metric: run.metric,
            evidenceDir: evidence,
            referenceSourceDir: best,
            candidateSourceDir: candidate,
          }),
        );
        if (run.sponsorMode) {
          await handoff("VerificationResult", repairAttempt, candidateHash, digest(JSON.stringify({ status: exp.status, guards: exp.guards, candidate: exp.candidate })));
          handoffCompleted = true;
        }
        exp.previewStatus = exp.status;
        if (exp.status === "accepted") {
          const previous = path.join(evidence, "previous-best");
          const journal = await promotion(
            project,
            run,
            exp,
            best,
            candidate,
            previous,
          );
          directory = within(best, project.config.outputDir || "dist");
          run.best = exp.candidate;
          project.lastAcceptedRun = run.id;
          project.lastAcceptedExperiment = exp.id;
          projects = await projectUpdate(project);
          await persistRun(run);
          await fs.unlink(journal).catch(() => {});
        }
        await log(
          run,
          exp.status,
          `Experiment ${index}: ${exp.status} — ${exp.reason}`,
        );
        break;
      } catch (e) {
        if (run.sponsorMode && handedToVerifier && !handoffCompleted && !signal.aborted) {
          await handoff("VerificationResult", repairAttempt, candidateHash, digest(JSON.stringify({ status: "rejected", error: String(e.message).slice(0, 1000) })));
          handoffCompleted = true;
        }
        if (signal.aborted || e.code === "VERIFICATION_POLICY_CHANGED" || (run.sponsorMode && (!handedToVerifier || !riskReady))) throw e;
        // Preserve each failed attempt before a repair replaces final evidence.
        const attemptDir = path.join(experimentDir, `attempt-${repairAttempt}`);
        await fs.mkdir(attemptDir, { recursive: true });
        for (const entry of await fs.readdir(experimentDir, { withFileTypes: true })) {
          if (entry.isFile()) await fs.copyFile(path.join(experimentDir, entry.name), path.join(attemptDir, entry.name));
        }
        if (repairAttempt < 2) {
          exp.repairs = exp.repairs || [];
          exp.repairs.push({
            attempt: repairAttempt + 1,
            error: String(e.message).slice(0, 16000),
            guards: exp.guards,
          });
          await log(
            run,
            "repair",
            `Repair ${repairAttempt + 1}: inspecting the failed candidate`,
          );
          try {
            const repaired = await proposeExperiment({
              investigation,
              workspace: candidate,
              mission: run.mission,
              manifest: project.discovery,
              metrics: run.best,
              history: [],
              strategy,
              config: { ...project.config, metric: run.metric },
              signal,
              repair: {
                attempt: repairAttempt + 1,
                error: String(e.message).slice(0, 16000),
                guards: exp.guards,
                patch: exp.diff,
              },
              onEvent: async (event) => {
                exp.trace = exp.trace || [];
                exp.trace.push(event);
                run.phase = event.message;
                await persistRun(run);
              },
            });
            if (!repaired.files.length)
              throw Error(repaired.notes || "No safe repair proposed");
            for (const file of repaired.files) {
              if (!project.config.editableFiles.includes(file.path))
                throw Error("Repair attempted a protected file");
              const current = await fs.readFile(
                await safeFile(candidate, file.path),
                "utf8",
              );
              if (repaired.sourceHashes?.[file.path] !== digest(current))
                throw Error("Candidate changed after inspection");
              if (sources[file.path] === undefined)
                sources[file.path] = await fs.readFile(
                  await safeFile(best, file.path),
                  "utf8",
                );
              await fs.writeFile(
                await safeFile(candidate, file.path),
                file.content,
              );
            }
            run.tokens += repaired.usage?.total_tokens || 0;
            exp.files = [
              ...new Set([...exp.files, ...repaired.files.map((f) => f.path)]),
            ];
            exp.diff = "";
            for (const file of exp.files)
              exp.diff += createTwoFilesPatch(
                "a/" + file,
                "b/" + file,
                sources[file],
                await fs.readFile(path.join(candidate, file), "utf8"),
              );
            await fs.writeFile(
              path.join(runDir(run), exp.id, "change.patch"),
              exp.diff,
            );
            exp.repairs.at(-1).files = repaired.files.map((f) => f.path);
            exp.status = "building";
            continue;
          } catch (repairError) {
            if (signal.aborted) throw repairError;
            exp.repairs.at(-1).repairError = String(repairError.message);
          }
        }
        exp.status = "rejected";
        exp.reason = String(e.message).slice(0, 3000);
        await log(
          run,
          "rejected",
          `Experiment ${index}: build or runtime check failed; best version unchanged`,
        );
        break;
      } finally {
        await persistRun(run);
      }
    }
  }
  run.status = "completed";
  await log(
    run,
    "complete",
    run.experiments.some((e) => e.status === "accepted")
      ? "Optimization finished. Accepted changes are available as a patch."
      : "No candidate accepted in this run. Best version unchanged.",
  );
}
export function abortCurrent() {
  active?.controller.abort();
}
export async function stop(runId) {
  await initialize();
  const run = runs.find((r) => r.id === (runId || activeRun()));
  if (!run) throw Error("No active run");
  await save(path.join(runDir(run), "cancel.json"), {
    at: new Date().toISOString(),
  });
  if (run.status === "queued") {
    run.status = "stopped";
    run.phase = "Cancelled before execution";
    await persistRun(run);
  }
  if (active?.runId === run.id) active.controller.abort();
  return run.id;
}
export function activeRun() {
  return (
    active?.runId ||
    runs.find((r) => ["running", "recovering", "queued"].includes(r.status))
      ?.id ||
    null
  );
}
export async function resume(runId) {
  await initialize();
  const run = runs.find((r) => r.id === runId);
  if (!run || !["failed", "interrupted", "stopped"].includes(run.status))
    throw Error("Only interrupted, stopped or failed runs can resume");
  if (
    runs.some(
      (r) =>
        r.projectId === run.projectId &&
        ["queued", "running"].includes(r.status),
    )
  )
    throw Error("Project already active");
  await fs.unlink(path.join(runDir(run), "cancel.json")).catch(() => {});
  for (const e of run.experiments)
    if (
      !["accepted", "rejected", "inconclusive", "interrupted"].includes(
        e.status,
      )
    ) {
      e.status = "interrupted";
      e.reason =
        "Previous attempt interrupted; resuming from the last safe checkpoint";
    }
  run.status = "queued";
  run.error = null;
  run.phase = "Queued to resume from checkpoint";
  await persistRun(run);
  return run;
}
export async function exportPatch(project) {
  let patch = "";
  for (const file of project.config.editableFiles) {
    const original = await fs.readFile(
      await safeFile(project.original, file),
      "utf8",
    );
    const best = await fs.readFile(
      await safeFile(path.join(projectDir(project), "best"), file),
      "utf8",
    );
    if (original !== best)
      patch += createTwoFilesPatch("a/" + file, "b/" + file, original, best);
  }
  return patch;
}
export async function apply(project) {
  if (activeRun()) throw Error("Wait until the active run finishes");
  const changes = [];
  for (const file of project.config.editableFiles) {
    const original = await safeFile(project.original, file);
    const content = await fs.readFile(original);
    if (digest(content) !== project.originalHashes[file])
      throw Error(
        "Original source changed since connection. Export the patch and resolve the conflict manually.",
      );
    const best = await fs.readFile(
      await safeFile(path.join(projectDir(project), "best"), file),
    );
    if (!content.equals(best)) changes.push({ file, original, content, best });
  }
  if (!changes.length) throw Error("No changes to apply");
  const backup = path.join(
    projectDir(project),
    "backups",
    new Date().toISOString().replaceAll(":", "-"),
  );
  for (const c of changes) {
    await fs.mkdir(path.dirname(path.join(backup, c.file)), {
      recursive: true,
    });
    await fs.writeFile(path.join(backup, c.file), c.content);
  }
  try {
    for (const c of changes) await fs.writeFile(c.original, c.best);
  } catch (e) {
    for (const c of changes) await fs.writeFile(c.original, c.content);
    throw e;
  }
  for (const c of changes) project.originalHashes[c.file] = digest(c.best);
  project.lastAppliedAt = new Date().toISOString();
  projects = await projectUpdate(project);
  return { files: changes.map((c) => c.file), backup };
}
