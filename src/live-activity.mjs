// Display state is derived from persisted evidence, never elapsed time or animation.
export const STAGES = ["scout", "gauge", "smith", "warden"];
export const STATUS_LABELS = {
  waiting: "Waiting", working: "Working", done: "Done", failed: "Failed",
  stopped: "Stopped", skipped: "Not run", sample: "Sample",
};
const FINAL_EXPERIMENT = new Set(["accepted", "rejected", "inconclusive", "failed", "stopped", "interrupted"]);
const FINAL_RUN = new Set(["completed", "failed", "stopped", "interrupted"]);
const roleIds = { investigator: "scout", optimizer: "gauge", risk: "smith", subq: "smith", verifier: "warden" };
export function eventOwner(event = {}) {
  if (roleIds[event.role]) return roleIds[event.role];
  if (["investigator"].includes(event.type)) return "scout";
  if (["optimizer", "agent", "repair", "build", "candidate-ready", "inconclusive"].includes(event.type)) return "gauge";
  if (["verifier", "risk"].includes(event.type)) return "smith";
  if (["profile", "verify", "benchmark", "challenge", "accepted", "rejected"].includes(event.type)) return "warden";
  return null;
}
function currentEvents(job, exp) {
  const events = job.events || [];
  if (!exp) return events;
  const began = Date.parse(exp.createdAt);
  if (Number.isFinite(began)) return events.filter(e => Date.parse(e.at) >= began);
  // Older run records have no experiment timestamp. Scope by the actual start log.
  const start = events.findLastIndex(e => e.type === "agent" && new RegExp(`Experiment ${exp.index || job.experiments.length}:`).test(e.message || ""));
  return start < 0 ? [] : events.slice(start);
}
function traceEntries(exp = {}) {
  const investigation = (exp.investigatorTrace || []).map(e => ({ ...e, role: "investigator" }));
  const optimizer = (exp.optimizerTrace || exp.trace || []).map(e => ({ ...e, role: e.role || "optimizer" }));
  return [...investigation, ...optimizer];
}
export function describeActivity(event = {}) {
  const rejected = event.status === "rejected" || event.ok === false;
  if (event.tool) {
    const result = rejected ? "Rejected" : event.ok === true || event.status === "completed" ? "Completed" : "Requested";
    const detail = event.error || (event.type === "agent-tool-result" ? event.message : "");
    return `${result} · ${event.tool}${event.path ? ` · ${event.path}` : ""}${detail ? ` — ${detail}` : ""}`;
  }
  if (event.type === "agent-provider-response")
    return `${event.provider || "Provider"}: ${event.message || "response"} (${event.status || "unknown"}${event.incompleteReason ? `, ${event.incompleteReason}` : ""})`;
  return event.message || event.error || event.type || "Recorded event";
}
function taskFromTrace(trace, fallback) {
  const event = trace.at(-1);
  if (!event) return fallback;
  if (event.status === "rejected" || event.ok === false) return describeActivity(event);
  const labels = { read_source: "Reading source", list_files: "Listing source files", search_source: "Searching source", submit_patch: "Submitting a focused patch", submit_investigation: "Submitting source-backed findings", read_profile: "Reading measured profile", inspect_dependencies: "Following dependencies" };
  return event.tool ? `${labels[event.tool] || event.tool}${event.path ? ` · ${event.path}` : ""}${event.ok === true ? " · completed" : ""}` : event.message || fallback;
}
export function deriveLiveActivity(job = {}, { preview = false, preparingOptimization = false } = {}) {
  const exp = job.experiments?.at(-1);
  const events = currentEvents(job, exp);
  const traces = traceEntries(exp);
  const stages = STAGES.map(id => ({ id, state: preview ? "sample" : "waiting", task: "Waiting for this stage.", log: [] }));
  const byId = Object.fromEntries(stages.map(s => [s.id, s]));
  const feed = [...events.map(e => ({ ...e, stage: eventOwner(e) })), ...traces.map(e => ({ ...e, stage: eventOwner(e) }))];
  const seen = new Set();
  const activity = feed.filter(e => {
    const key = JSON.stringify([e.stage, e.at, e.type, e.tool, e.path, e.message, e.ok, e.status]);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).map(e => ({ ...e, text: describeActivity(e), rejected: e.status === "rejected" || e.ok === false }));
  // Timestamps exist for run events and final tool records; live trace callbacks
  // sometimes omit them. Keep their recorded order rather than inventing times.
  for (const stage of stages) stage.log = activity.filter(e => e.stage === stage.id);
  if (preview) {
    for (const stage of stages) stage.task = "Illustrated sample only; no agent or tool is running.";
    return { stages, activity: activity.map(e => ({ ...e, text: `Sample · ${e.text}` })), activeId: null, completedCount: 0, summary: "Sample workflow · nothing is running", detail: null };
  }
  const onlyVerifier = ["profile", "challenge", "guard-check"].includes(job.kind);
  const noSponsor = job.sponsorMode === false;
  if (onlyVerifier) for (const id of ["scout", "gauge", "smith"]) {
    byId[id].state = preparingOptimization ? "waiting" : "skipped";
    byId[id].task = preparingOptimization ? "Waiting for the reference baseline; optimization follows automatically." : "This run does not call this AI stage.";
  }
  else {
    if (noSponsor) { byId.scout.state = "skipped"; byId.scout.task = "No separate Investigator was requested; the Optimizer inspects source."; }
    if (noSponsor) { byId.smith.state = "skipped"; byId.smith.task = "SubQ risk assessment was not enabled for this run."; }
  }
  const lastStageEvent = events.findLast(e => eventOwner(e) && !["accepted", "rejected", "inconclusive"].includes(e.type));
  const lastRepairIndex = events.findLastIndex(e => e.type === "repair");
  const lastRiskIndex = events.findLastIndex(e => ["verifier", "risk"].includes(e.type));
  const repairAfterRisk = lastRepairIndex > lastRiskIndex;
  const riskStarted = lastRiskIndex >= 0 && !repairAfterRisk;
  const assessment = exp?.riskAssessment;
  const riskFresh = !!assessment && (!repairAfterRisk || Date.parse(assessment.assessedAt) > Date.parse(events[lastRepairIndex]?.at));
  const status = exp?.status;
  let activeId = null;
  if (job.status !== "queued") {
    if (onlyVerifier) activeId = "warden";
    else if (!exp) activeId = "warden"; // Actual build/profile setup, not a completed verification.
    else if (lastStageEvent?.type === "repair") activeId = "gauge";
    else if (["verifying", "checking", "benchmarking"].includes(status)) activeId = "warden";
    else if (status === "building") activeId = riskStarted && !riskFresh ? "smith" : "gauge";
    else if (status === "reasoning") activeId = exp.investigation || (exp.optimizerTrace || exp.trace || []).length || noSponsor ? "gauge" : "scout";
    else activeId = eventOwner(lastStageEvent) || ((exp.optimizerTrace || exp.trace || []).length ? "gauge" : "scout");
  }
  if (exp?.investigation) { byId.scout.state = "done"; byId.scout.task = exp.investigation.hypothesis || "Source-backed investigation recorded."; }
  const checks = exp?.guards?.checks || [];
  const verifierVerdict = !!exp?.verifier?.artifact && ["accepted", "rejected", "inconclusive"].includes(status) && typeof exp?.guards?.pass === "boolean";
  const built = exp?.previewReady || ["verifying", "checking", "benchmarking"].includes(status) || verifierVerdict;
  if (!onlyVerifier && exp?.files?.length && !built) {
    byId.gauge.task = `Patch written · ${exp.files.join(", ")}; candidate build pending.`;
  }
  if (!onlyVerifier && (built || exp?.agentOutcome === "no-candidate")) {
    byId.gauge.state = "done";
    byId.gauge.task = exp.agentOutcome === "no-candidate" ? exp.reason || "No safe candidate proposed." : `Candidate built${exp.files?.length ? ` · ${exp.files.join(", ")}` : "."}`;
  }
  if (riskFresh && !onlyVerifier) {
    byId.smith.state = "done";
    byId.smith.task = `Risk assessment recorded${assessment.provider ? ` · ${assessment.provider}` : ""}.`;
  }
  if (exp?.guards?.pass === false && !verifierVerdict && !onlyVerifier) {
    byId.warden.state = "failed";
    byId.warden.task = "Previous candidate failed correctness checks; waiting for a repaired build.";
  }
  if (verifierVerdict || (onlyVerifier && !preparingOptimization && job.status === "completed" && (job.kind === "profile" ? !!job.baseline : job.kind === "challenge" ? !!job.challengeResult : typeof exp?.guards?.pass === "boolean"))) {
    byId.warden.state = "done";
    byId.warden.task = verifierVerdict ? `${status}: ${exp.reason || "Deterministic verdict recorded."}` : job.kind === "profile" ? "Baseline measured. No optimization or candidate verification was performed." : job.kind === "challenge" ? `Challenge ${job.challengeResult.status}; inspect recorded evidence.` : "Negative-control check finished; inspect guard results.";
  }
  if (job.status === "queued") activeId = null;
  else if (FINAL_RUN.has(job.status) || FINAL_EXPERIMENT.has(status)) {
    const stopped = ["stopped", "interrupted"].includes(job.status) || ["stopped", "interrupted"].includes(status);
    const failed = job.status === "failed" || status === "failed";
    if (stopped || failed) {
      // A terminal run cannot keep a planet working. Mark the interrupted role,
      // preserving completed evidence from the other stages.
      const failedRole = byId[activeId] || byId.gauge;
      failedRole.state = stopped ? "stopped" : "failed";
      failedRole.task = job.error || exp?.reason || (stopped ? "Run stopped before this stage completed." : "This stage failed; inspect the recorded error.");
    } else if (status === "rejected" && !verifierVerdict) {
      const checkFailure = exp?.guards?.pass === false;
      const role = checkFailure ? byId.warden : byId.gauge;
      role.state = "failed";
      role.task = exp.reason || (checkFailure ? "Correctness checks rejected the candidate." : "Candidate build or runtime checks failed.");
    }
    activeId = null;
  }
  if (activeId) {
    const stage = byId[activeId];
    stage.state = "working";
    const last = events.findLast(e => eventOwner(e) === activeId);
    if (activeId === "scout") stage.task = taskFromTrace(traces.filter(e => e.role === "investigator"), last?.message || "Inspecting source and measured bottlenecks.");
    if (activeId === "gauge") stage.task = status === "building" && lastStageEvent?.type !== "repair"
      ? `${lastStageEvent?.type === "build" ? lastStageEvent.message : "Preparing the candidate build"}${exp?.files?.length ? ` · ${exp.files.join(", ")}` : ""}`
      : taskFromTrace(traces.filter(e => e.role !== "investigator"), last?.message || "Inspecting source and preparing a focused patch.");
    if (activeId === "smith") stage.task = last?.message || "Assessing patch regression risks with SubQ.";
    if (activeId === "warden") stage.task = last?.message || job.phase || "Preparing the reference build and baseline measurements.";
  }
  let detail = null;
  if (activeId === "warden" && checks.length) {
    const passed = checks.filter(c => c.visualPass === true && c.statePass === true && c.pickingPass !== false).length;
    detail = `${passed} of ${checks.length} recorded checkpoints passed; final verdict ${verifierVerdict ? "recorded" : "pending"}.`;
  } else if (activeId === "smith" && riskFresh && assessment.probabilities) detail = Object.entries(assessment.probabilities).map(([k,v]) => `${k}: ${v}`).join(" · ");
  const completedCount = stages.filter(s => s.state === "done").length;
  const summary = preparingOptimization ? "Preparing reference · AI stages follow the baseline" : job.status === "queued" ? "Waiting for the local worker" : ["failed", "stopped", "interrupted"].includes(job.status) ? `Run ${job.status}` : job.status === "completed" ? "Run finished · inspect the verdict" : `Live activity${exp?.index ? ` · experiment ${exp.index}` : " · preparing baseline"}`;
  return { stages, activity, activeId, completedCount, summary, detail };
}
