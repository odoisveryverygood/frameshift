import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  FileCode2,
  Layers3,
  Loader2,
  Maximize2,
  MoreHorizontal,
  Pause,
  Play,
  Radio,
  RotateCcw,
  ScanLine,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  TriangleAlert,
  X,
} from "lucide-react";

import {
  Diff,
  Empty,
  Evidence,
  ExperimentSelector,
  Status,
  firstLine,
  fmt,
  runVerdict,
} from "./parts.jsx";
import Dashboard from "./Dashboard.jsx";
import Loading from "./Loading.jsx";
import Hero from "./Hero.jsx";
import Rip, { snapshotHtml } from "./Rip.jsx";
import "./style.css";
const liveStatuses = ["queued", "running", "recovering"];
const terminalStatuses = [
  "accepted",
  "rejected",
  "inconclusive",
  "completed",
  "stopped",
  "failed",
  "interrupted",
];
const steps = ["Ready", "Measure", "Patch", "Check", "Result"];
async function api(url, body) {
  const response = await fetch(
    "/api" + url,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "Request failed");
  return data;
}
// Maps a live job onto the automatic workspace states. Only fields the runner
// actually writes are used: the baseline checkpoint and experiment statuses.
function jobPhase(job) {
  if (!job) return null;
  if (job.status === "queued") return "queued";
  if (job.kind !== "optimize" || !job.baseline) return "measuring";
  const status = job.experiments?.at(-1)?.status;
  if (["verifying", "checking", "benchmarking"].includes(status))
    return "checking";
  return "patching";
}
function App() {
  const [data, setData] = useState({ projects: [], runs: [], provider: {} }),
    [projectId, setProjectId] = useState(() => {
      try {
        return (
          new URLSearchParams(location.search).get("project") ||
          localStorage.getItem("frameshift:project") ||
          ""
        );
      } catch {
        return "";
      }
    }),
    [mission, setMission] = useState(""),
    [runId, setRunId] = useState(null),
    [experimentId, setExperimentId] = useState(null),
    [modal, setModal] = useState(null),
    [drawer, setDrawer] = useState(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [connectionError, setConnectionError] = useState(""),
    [paused, setPaused] = useState(false),
    [compare, setCompare] = useState(false),
    [details, setDetails] = useState(false),
    [time, setTime] = useState(0),
    [camera, setCamera] = useState(0),
    [telemetry, setTelemetry] = useState(null),
    [objects, setObjects] = useState([]),
    [selectedObject, setSelectedObject] = useState(null),
    [count, setCount] = useState(2),
    [recording, setRecording] = useState(false),
    [recorded, setRecorded] = useState([]),
    [source, setSource] = useState(null),
    [frameCapture, setFrameCapture] = useState(null),
    [failedBaseline, setFailedBaseline] = useState(null),
    [phase, setPhase] = useState("hero"),
    [rip, setRip] = useState(null);
  const preview = useRef(null),
    reference = useRef(null),
    viewport = useRef(null),
    recordingRef = useRef(false),
    recordedRef = useRef([]),
    recordStart = useRef(0),
    lastActiveRun = useRef(null),
    sceneRef = useRef(null),
    heroRef = useRef(null),
    phaseRef = useRef("hero"),
    afterRip = useRef(null),
    starting = useRef(false),
    autoRun = useRef(null),
    prevJob = useRef(null);
  const refresh = async () => {
    try {
      setData(await api("/state"));
      setConnectionError("");
    } catch (e) {
      setConnectionError(e.message);
    }
  };
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 1700);
    const events = new EventSource("/api/events");
    events.onmessage = refresh;
    return () => {
      clearInterval(timer);
      events.close();
    };
  }, []);
  const project =
    data.projects.find((p) => p.id === projectId) || data.projects[0];
  const projectRuns = data.runs.filter((r) => r.projectId === project?.id);
  const run = projectRuns.find((r) => r.id === runId) || projectRuns[0];
  const active =
    data.runs.find((r) => r.id === data.activeRun) ||
    data.runs.find((r) => liveStatuses.includes(r.status));
  const running = Boolean(active);
  const projectJob = projectRuns.find((r) => liveStatuses.includes(r.status));
  const experiment =
    run?.experiments?.find((e) => e.id === experimentId) ||
    run?.experiments?.findLast((e) => e.guards) ||
    run?.experiments?.at(-1);
  const accepted =
    run?.experiments?.filter((e) => e.status === "accepted") || [];
  const baseline = run?.baseline,
    best = run?.best || baseline;
  const latestBaseline = projectRuns.find((r) => r.baseline)?.baseline;
  const discovery = project?.discovery || {};
  const files = Array.isArray(discovery.files) ? discovery.files : [];
  const scenarioCount =
    project?.config?.scenario?.events?.length ||
    project?.scenario?.events?.length ||
    0;
  // The result card is pinned to the selected run and one of its experiments,
  // so the verdict, measurement, code, evidence and actions always agree.
  const resultRun =
    !projectJob &&
    run?.kind === "optimize" &&
    terminalStatuses.includes(run.status)
      ? run
      : null;
  const resultExperiment = resultRun
    ? accepted.at(-1) ||
      resultRun.experiments?.findLast((e) => e.guards) ||
      resultRun.experiments?.at(-1)
    : null;
  const verdict = resultRun ? runVerdict(resultRun, resultExperiment) : null;
  const resultIsWorkspace =
    verdict === "accepted" &&
    project?.lastAcceptedRun === resultRun.id &&
    project?.lastAcceptedExperiment === resultExperiment?.id;
  const dashRun = run?.baseline ? run : projectRuns.find((r) => r.baseline);
  const view = !project
    ? "welcome"
    : projectJob
      ? jobPhase(projectJob)
      : active
        ? "elsewhere"
        : resultRun
          ? "result"
          : !project.built
            ? run?.status === "failed"
              ? "build-failed"
              : "unbuilt"
            : run?.status === "failed"
              ? "attention"
              : "ready";
  const stepIndex = {
    welcome: 0,
    unbuilt: 0,
    ready: 0,
    attention: 0,
    "build-failed": 1,
    queued: 1,
    elsewhere: 0,
    measuring: 1,
    patching: 2,
    checking: 3,
    result: 4,
  }[view];
  const activityRun = projectJob || run;
  const activityEvents = activityRun?.events || [];
  useEffect(() => {
    if (!project) return;
    try {
      localStorage.setItem("frameshift:project", project.id);
    } catch {}
    // Keep the URL authoritative so a refresh returns to this project.
    const url = new URL(location.href);
    if (url.searchParams.get("project") !== project.id) {
      url.searchParams.set("project", project.id);
      history.replaceState(null, "", url);
    }
    try {
      setMission(localStorage.getItem("earl:mission:" + project.id) || "");
    } catch {}
    setTelemetry(null);
    setObjects([]);
    setSelectedObject(null);
    setCompare(false);
    setDetails(false);
    setTime(0);
    setPaused(false);
    setRecording(false);
    recordingRef.current = false;
    recordedRef.current = [];
    setRecorded([]);
  }, [project?.id]);
  useEffect(() => {
    phaseRef.current = phase;
    if (phase === "results") window.scrollTo(0, 0);
  }, [phase]);
  useEffect(() => {
    if (projectJob && lastActiveRun.current !== projectJob.id) {
      setRunId(projectJob.id);
      setExperimentId(null);
      setCompare(false);
      lastActiveRun.current = projectJob.id;
    }
    // A run that started elsewhere (a reload mid-run, "Profile again") shows its progress.
    if (
      projectJob &&
      !starting.current &&
      (phase === "hero" || phase === "results")
    )
      setPhase("work");
  }, [projectJob?.id, phase]);
  // When a run ends, the dashboard opens (unless the improvement is about to follow the build).
  useEffect(() => {
    const previous = prevJob.current;
    if (projectJob) {
      prevJob.current = projectJob.id;
      return;
    }
    if (!previous) return;
    prevJob.current = null;
    const finished = data.runs.find((r) => r.id === previous);
    if (!finished || !terminalStatuses.includes(finished.status)) return;
    if (
      finished.kind === "profile" &&
      finished.status === "completed" &&
      autoRun.current
    )
      return;
    setRunId(previous);
    setExperimentId(null);
    if (phaseRef.current === "work" || phaseRef.current === "rip") finishWork();
  }, [projectJob?.id, data.runs]);
  // Never leave the page on a progress screen with nothing running.
  useEffect(() => {
    if (phase !== "work" || projectJob) return;
    const timer = setTimeout(() => {
      if (!autoRun.current) setPhase(dashRun ? "results" : "hero");
    }, 6000);
    return () => clearTimeout(timer);
  }, [phase, projectJob?.id, data.runs.length]);
  // After the first build, the improvement starts on the goal from the hero.
  useEffect(() => {
    const id = autoRun.current;
    if (!id || !project || project.id !== id || running || busy) return;
    const first = projectRuns.find((r) => r.kind === "profile");
    if (!first) return;
    if (first.status === "completed" && project.built) {
      autoRun.current = null;
      let goal = "";
      try {
        goal = localStorage.getItem("earl:mission:" + id) || "";
      } catch {}
      if (data.provider.configured) launch("optimize", goal);
      else {
        setNotice("Baseline ready. Connect a model to run the optimization.");
        finishWork();
      }
    } else if (terminalStatuses.includes(first.status)) autoRun.current = null;
  }, [data, busy]);
  useEffect(() => {
    if (!modal && !drawer && !details) return;
    const close = (e) => {
      if (e.key === "Escape") {
        setModal(null);
        setDrawer(null);
        setDetails(false);
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [modal, drawer, details]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 9000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const handler = (e) => {
      if (
        ![location.origin, "null"].includes(e.origin) ||
        ![
          preview.current?.contentWindow,
          reference.current?.contentWindow,
        ].includes(e.source)
      )
        return;
      const value = e.data;
      if (!value || typeof value !== "object") return;
      if (
        value.type === "frameshift:telemetry" &&
        e.source === preview.current?.contentWindow
      ) {
        const submit = Array.isArray(value.submit)
          ? value.submit.filter(Number.isFinite).slice(-100)
          : [];
        const frames = Array.isArray(value.frames)
          ? value.frames.filter(Number.isFinite).slice(-100)
          : [];
        if (Number.isFinite(value.calls) && Number.isFinite(value.triangles))
          setTelemetry({
            calls: value.calls,
            triangles: value.triangles,
            submit,
            frames,
            renderer: value.renderer,
          });
      }
      if (value.type === "frameshift:objects") {
        const items = Array.isArray(value.objects)
          ? value.objects
          : Array.isArray(value.items)
            ? value.items
            : [];
        setObjects(
          items
            .slice(0, 300)
            .map((o) => (typeof o === "string" ? { id: o, name: o } : o))
            .filter((o) => o && o.id != null),
        );
      }
      if (value.type === "frameshift:error")
        setNotice(String(value.message || "Scene replay failed").slice(0, 300));
      if (value.type === "frameshift:selection")
        setSelectedObject(value.object || value.id || null);
      if (
        value.type === "frameshift:interaction" &&
        recordingRef.current &&
        e.source === preview.current?.contentWindow
      ) {
        const event = value.event || value.interaction;
        if (event && recordedRef.current.length < 80) {
          const at = Number.isFinite(event.at)
            ? event.at
            : (performance.now() - recordStart.current) / 1000;
          if (at > 60) return;
          const last = recordedRef.current.at(-1);
          if (
            event.type === "pointermove" &&
            last?.type === "pointermove" &&
            at - (last.at || 0) < 0.15
          )
            return;
          const item = {
            ...event,
            at,
          };
          recordedRef.current.push(item);
          setRecorded([...recordedRef.current]);
        }
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);
  async function act(fn) {
    setBusy(true);
    try {
      const value = await fn();
      await refresh();
      return { ok: true, value };
    } catch (e) {
      setNotice(e.message);
      return { ok: false };
    } finally {
      setBusy(false);
    }
  }
  function send(message) {
    for (const frame of [preview, reference])
      frame.current?.contentWindow?.postMessage(message, "*");
  }
  function replay(t = time, view = camera) {
    setTime(t);
    setCamera(view);
    setPaused(true);
    send({ type: "frameshift:step", time: t, view });
  }
  function pause() {
    setPaused((v) => {
      send({ type: v ? "frameshift:resume" : "frameshift:pause" });
      return !v;
    });
  }
  function chooseProject(id) {
    const url = new URL(location.href);
    url.searchParams.set("project", id);
    history.replaceState(null, "", url);
    setProjectId(id);
    setRunId(null);
    setExperimentId(null);
  }
  function goHero() {
    setRip(null);
    setPhase("hero");
    window.scrollTo(0, 0);
  }
  // Real source for the code revealed under the hero; falls back to nothing.
  async function loadCode(p) {
    const files = p.discovery?.files || [];
    const picks = (
      files.some((f) => f.usesThree) ? files.filter((f) => f.usesThree) : files
    ).slice(0, 2);
    const out = [];
    for (const f of picks) {
      try {
        const src = await api(
          "/projects/" + p.id + "/source?path=" + encodeURIComponent(f.path),
        );
        out.push({
          path: f.path,
          lines: String(src.content || "")
            .split("\n")
            .slice(0, 46)
            .map((l) => l.slice(0, 96)),
        });
      } catch {}
    }
    return out;
  }
  // Starts an optimization from the hero. The rip transition plays only once a
  // run really exists, so a refused request never tears the page apart.
  async function beginOptimize(getProject, origin) {
    const el = heroRef.current;
    const html = el ? snapshotHtml(el) : "";
    const box = el
      ? el.getBoundingClientRect()
      : { left: 0, top: 0, width: innerWidth, height: innerHeight };
    starting.current = true;
    const goal = mission.trim();
    const result = await act(async () => {
      const p = await getProject();
      try {
        localStorage.setItem("earl:mission:" + p.id, goal);
      } catch {}
      chooseProject(p.id);
      await refresh();
      if (p.built) {
        if (!data.provider.configured) {
          setModal("settings");
          return null;
        }
        await api("/projects/" + p.id + "/runs", {
          kind: "optimize",
          count,
          mission: goal,
        });
      } else {
        autoRun.current = p.id;
        await api("/projects/" + p.id + "/runs", { kind: "profile" });
      }
      return p;
    });
    if (!result.ok || !result.value) {
      starting.current = false;
      return;
    }
    setRip({
      html,
      rect: {
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
      },
      origin: origin || { x: innerWidth / 2, y: innerHeight / 2 },
      code: null,
    });
    setPhase("rip");
    starting.current = false;
    loadCode(result.value).then((code) =>
      setRip((r) => (r ? { ...r, code } : r)),
    );
  }
  const optimizeFromHero = (body, origin) =>
    beginOptimize(() => (body ? api("/projects", body) : project), origin);
  const optimizeExample = (name, origin) =>
    beginOptimize(() => api("/examples/" + name, {}), origin);
  function ripDone() {
    const next = afterRip.current;
    afterRip.current = null;
    setRip(null);
    setPhase(next || "work");
  }
  function finishWork() {
    if (phaseRef.current === "rip") afterRip.current = "results";
    else setPhase("results");
  }
  function updateMission(value) {
    setMission(value);
    if (project) {
      try {
        localStorage.setItem("earl:mission:" + project.id, value);
      } catch {}
    }
  }
  async function launch(kind, goal) {
    if (!project) return;
    if (kind === "optimize" && !data.provider.configured)
      return setModal("settings");
    return act(async () => {
      setCompare(false);
      setExperimentId(null);
      const r = await api("/projects/" + project.id + "/runs", {
        kind,
        count,
        mission: (goal ?? mission).trim(),
      });
      setRunId(r.id);
    });
  }
  async function inspectFile(file) {
    await act(async () => {
      const s = await api(
        "/projects/" +
          project.id +
          "/source?path=" +
          encodeURIComponent(file.path || file),
      );
      setSource({
        path: file.path || file,
        content: s.content ?? s.source ?? "",
        ...s,
      });
      setDrawer("source");
    });
  }
  async function record() {
    if (recording) {
      recordingRef.current = false;
      setRecording(false);
      send({ type: "frameshift:record-stop" });
      await act(async () => {
        await api("/projects/" + project.id + "/scenario", {
          events: recordedRef.current,
        });
        setNotice(
          `Saved ${recordedRef.current.length} interaction${recordedRef.current.length === 1 ? "" : "s"} for replay checks.`,
        );
      });
      return;
    }
    recordedRef.current = [];
    setRecorded([]);
    recordStart.current = performance.now();
    recordingRef.current = true;
    setRecording(true);
    setPaused(false);
    send({ type: "frameshift:resume" });
    send({ type: "frameshift:record-start" });
  }
  function openResult(kind) {
    if (!resultRun || !resultExperiment) return;
    setRunId(resultRun.id);
    setExperimentId(resultExperiment.id);
    setDrawer(kind);
  }
  const selectedObjectInfo =
    typeof selectedObject === "object"
      ? selectedObject
      : objects.find((o) => String(o.id) === String(selectedObject));
  const selectedName = selectedObject
    ? selectedObjectInfo?.name ||
      (typeof selectedObject === "object" ? selectedObject.id : selectedObject)
    : null;
  const canRecord =
    !running && project?.built && !busy && project?.config?.autoInstrument;
  const showBaselineImage =
    projectJob?.baseline && failedBaseline !== projectJob.id;
  const status = {
    welcome: {
      title: "Connect a project",
      text: "Sift measures your Three.js app, tries a fix on a copy, and checks it before anything reaches your source.",
    },
    unbuilt: {
      title: "Build a first preview",
      text: "Sift builds the project and measures a baseline. This does not call the model.",
    },
    "build-failed": {
      title: "The build failed",
      text: "Sift could not build a preview of this project.",
    },
    attention: {
      title: "The last run needs attention",
      text: firstLine(run?.error || run?.phase),
    },
    queued: {
      title: "Queued",
      text: "Saved in the queue. It starts when the local worker is free.",
    },
    elsewhere: {
      title: "Worker busy",
      text: "Another project is being measured. Your project is unchanged and its preview resumes when the worker is free.",
    },
    measuring: {
      title: projectJob?.baseline ? "Measuring" : "Building and measuring",
      text: projectJob?.phase,
    },
    patching: { title: "Trying a patch", text: projectJob?.phase },
    checking: { title: "Checking the patch", text: projectJob?.phase },
    ready: {
      title: latestBaseline ? "Ready" : "Preview ready",
      text: latestBaseline
        ? "Baseline measured on this machine. Describe what feels slow."
        : "Describe what feels slow, then let Sift try an improvement.",
    },
    result: {
      title: {
        accepted: "Improvement verified",
        rejected: "No change kept",
        inconclusive: "Inconclusive",
        failed: "The run failed",
        stopped: "Stopped",
        interrupted: "Interrupted",
        "no-attempt": "No attempt finished",
      }[verdict],
      text: resultRun?.phase,
    },
  }[view];
  return (
    <div
      className={
        "app " + (phase === "hero" || phase === "rip" ? "is-hero" : "")
      }
    >
      {phase === "hero" && (
        <div inert={modal || drawer ? true : undefined}>
          <Hero
            ref={heroRef}
            projects={data.projects}
            project={project}
            onPickProject={chooseProject}
            onResults={dashRun ? () => setPhase("results") : undefined}
            onSettings={() => setModal("settings")}
            onHelp={() => setModal("help")}
            sourceCount={files.length}
            busy={busy}
            running={running}
            mission={mission}
            onMission={updateMission}
            providerConfigured={Boolean(data.provider.configured)}
            onInspect={(path) => api("/inspect", { path })}
            onOptimize={optimizeFromHero}
            onExample={optimizeExample}
          />
        </div>
      )}
      {phase === "rip" && rip && (
        <Rip
          html={rip.html}
          rect={rip.rect}
          origin={rip.origin}
          code={rip.code}
          onDone={ripDone}
        />
      )}
      {(phase === "work" || phase === "results") && (
        <>
          <header className="topbar" inert={modal || drawer ? true : undefined}>
            <a
              href="./"
              className="wordmark"
              aria-label="Sift"
              onClick={(e) => {
                e.preventDefault();
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              sift<span>.</span>
            </a>
            {data.projects.length > 0 && (
              <label className="project-picker">
                <span className="visually-hidden">Active project</span>
                <select
                  value={project?.id || ""}
                  onChange={(e) => chooseProject(e.target.value)}
                >
                  {data.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <ChevronDown size={13} aria-hidden="true" />
              </label>
            )}
            {project && (
              <span className="project-meta">
                {discovery.framework || "Three.js"}
                {discovery.threeVersion ? " · " + discovery.threeVersion : ""}
              </span>
            )}

            <div className="topbar-end">
              {phase === "results" && (
                <button className="secondary-button" onClick={goHero}>
                  New optimization
                </button>
              )}
              {phase === "work" && projectJob && (
                <>
                  <button
                    className="link-button"
                    onClick={() => setDrawer("logs")}
                  >
                    Full log
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() =>
                      act(() => api("/stop", { runId: projectJob.id }))
                    }
                  >
                    <Square size={11} /> Stop
                  </button>
                </>
              )}
              <span
                className={
                  "connection " +
                  (connectionError || data.worker?.alive === false
                    ? "offline"
                    : "")
                }
                role="status"
              >
                <i aria-hidden="true" />
                <span>
                  {connectionError
                    ? "Runner offline"
                    : data.worker?.alive === false
                      ? "Worker offline"
                      : "Local"}
                </span>
              </span>
              <Menu
                label="Project menu"
                hideLabel
                icon={MoreHorizontal}
                items={[
                  {
                    label: "New optimization",
                    onClick: goHero,
                  },
                  project && {
                    label: latestBaseline ? "Profile again" : "Build preview",
                    hint: "Build and measure, no model",
                    disabled: running || busy,
                    onClick: () => launch("profile"),
                  },
                  "-",
                  project && {
                    label: "Run history",
                    onClick: () => setDrawer("history"),
                  },
                  project && {
                    label: "Measurements",
                    onClick: () => setDrawer("measurements"),
                  },
                  {
                    label: "Run details & logs",
                    onClick: () => setDrawer("logs"),
                  },
                  project && {
                    label: "Project source",
                    onClick: () => setDrawer("files"),
                  },
                  project?.lastAcceptedRun && {
                    label: "Export accepted patch",
                    href: "/api/projects/" + project.id + "/patch",
                  },
                  "-",
                  {
                    label: "Model settings",
                    hint: data.provider.configured
                      ? data.provider.model
                      : "Not configured",
                    onClick: () => setModal("settings"),
                  },
                  {
                    label: "Help & compatibility",
                    onClick: () => setModal("help"),
                  },
                ]}
              />
            </div>
          </header>
          <div className="page" inert={modal || drawer ? true : undefined}>
            {phase === "work" ? (
              projectJob ? (
                <Loading
                  job={projectJob}
                  project={project}
                  goal={mission}
                  baselineSrc={
                    projectJob.baseline && failedBaseline !== projectJob.id
                      ? "/api/runs/" +
                        projectJob.id +
                        "/baseline/baseline-0.png"
                      : null
                  }
                />
              ) : (
                <p className="results-empty">Finishing up…</p>
              )
            ) : (
              <>
                <div className="notes">
                  {(connectionError || data.worker?.alive === false) && (
                    <Note tone="error">
                      {connectionError
                        ? "Sift's local runner is not responding: " +
                          connectionError
                        : "The independent worker is offline. Queued jobs start when it returns."}
                    </Note>
                  )}
                  {project && discovery.supported === false && (
                    <Note tone="error">
                      This project is outside the supported Vite + Three.js
                      path.
                    </Note>
                  )}
                </div>
                <section className="block" aria-labelledby="step-results">
                  <h2 className="block-title" id="step-results">
                    Results
                  </h2>
                  {dashRun ? (
                    <Dashboard
                      project={project}
                      run={dashRun}
                      runs={projectRuns}
                      experimentId={experimentId}
                      onExperiment={setExperimentId}
                      onSelectRun={(id) => {
                        setRunId(id);
                        setExperimentId(null);
                      }}
                      busy={busy}
                      provider={data.provider}
                      onScene={() =>
                        sceneRef.current?.scrollIntoView({ behavior: "smooth" })
                      }
                      onCompare={() => {
                        setCompare(true);
                        sceneRef.current?.scrollIntoView({
                          behavior: "smooth",
                        });
                      }}
                      onApply={() => setModal("apply")}
                      onLogs={() => setDrawer("logs")}
                    />
                  ) : (
                    <div className="results-empty">
                      <p>
                        {run?.error || run?.phase
                          ? firstLine(run.error || run.phase)
                          : "Sift has no measurements for this project yet."}
                      </p>
                      <div className="button-row">
                        <button className="primary-button" onClick={goHero}>
                          Back to start
                        </button>
                        {run && (
                          <button
                            className="secondary-button"
                            onClick={() => setDrawer("logs")}
                          >
                            View log
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </section>
                <section
                  className="block"
                  aria-labelledby="step-scene"
                  ref={sceneRef}
                >
                  <h2 className="block-title" id="step-scene">
                    Scene
                  </h2>
                  <div className="status-line" aria-live="polite">
                    <p>
                      <b>{status.title}</b>
                      {status.text ? " · " + status.text : ""}
                    </p>
                  </div>
                  <main
                    className={"stage " + (compare ? "is-comparing" : "")}
                    ref={viewport}
                    aria-label="Project scene"
                  >
                    {view === "elsewhere" ? (
                      <div className="stage-paused">
                        {showBaselineImage && (
                          <img
                            src={
                              "/api/runs/" +
                              projectJob.id +
                              "/baseline/baseline-0.png"
                            }
                            alt="Baseline frame captured for this run"
                            onError={() => setFailedBaseline(projectJob.id)}
                          />
                        )}
                        <div className="stage-badge">
                          <Pause size={12} aria-hidden="true" />
                          {view === "queued"
                            ? "Queued · preview paused"
                            : view === "elsewhere"
                              ? "Paused while another project is measured"
                              : "Paused for measurement"}
                        </div>
                        {!showBaselineImage && (
                          <div className="stage-message">
                            <Loader2
                              className="spin"
                              size={20}
                              aria-hidden="true"
                            />
                            <p>
                              {view === "queued"
                                ? "Waiting for the local worker."
                                : view === "elsewhere"
                                  ? "The live preview is off so measurements stay uncontended."
                                  : "Building the project. The live preview is off while Sift measures."}
                            </p>
                          </div>
                        )}
                      </div>
                    ) : project?.built ? (
                      <>
                        <div className="frames">
                          <figure className="frame">
                            <iframe
                              sandbox="allow-scripts"
                              ref={preview}
                              key={
                                project.id +
                                ":" +
                                (project.lastAcceptedExperiment || "initial")
                              }
                              src={"/preview/" + project.id + "/index.html"}
                              title="Current project scene"
                              onLoad={() => {
                                if (paused) replay();
                                preview.current?.contentWindow?.postMessage(
                                  { type: "frameshift:objects" },
                                  "*",
                                );
                              }}
                            />
                            {compare && (
                              <figcaption>
                                {project.lastAcceptedExperiment
                                  ? "With accepted changes"
                                  : "Current workspace"}
                              </figcaption>
                            )}
                          </figure>
                          {compare && (
                            <figure className="frame">
                              <iframe
                                sandbox="allow-scripts"
                                ref={reference}
                                src={"/baseline/" + project.id + "/index.html"}
                                title="Original project scene"
                                onLoad={() => replay()}
                              />
                              <figcaption>Original</figcaption>
                            </figure>
                          )}
                        </div>
                        {recording && (
                          <div className="stage-badge recording" role="status">
                            <i aria-hidden="true" />
                            Recording · {recorded.length} action
                            {recorded.length === 1 ? "" : "s"}
                          </div>
                        )}
                        {selectedName && !recording && (
                          <div className="selection-chip">
                            <Box size={12} aria-hidden="true" />
                            <span>{selectedName}</span>
                            <button
                              aria-label="Clear object selection"
                              onClick={() => {
                                setSelectedObject(null);
                                send({ type: "frameshift:select", id: null });
                              }}
                            >
                              <X size={12} />
                            </button>
                          </div>
                        )}
                        <div
                          className="scene-toolbar"
                          role="toolbar"
                          aria-label="Scene"
                        >
                          <button
                            className="tool"
                            aria-label={paused ? "Resume scene" : "Pause scene"}
                            title={paused ? "Resume" : "Pause"}
                            onClick={pause}
                          >
                            {paused ? <Play size={15} /> : <Pause size={15} />}
                          </button>
                          <button
                            className={
                              "tool labeled " +
                              (recording ? "is-recording" : "")
                            }
                            disabled={!canRecord && !recording}
                            onClick={record}
                            title={
                              !project.config?.autoInstrument
                                ? "Recording needs the automatic integration"
                                : "Record actions for replay checks"
                            }
                          >
                            {recording ? (
                              <Square size={11} />
                            ) : (
                              <Radio size={14} />
                            )}
                            <span>{recording ? "Stop & save" : "Record"}</span>
                          </button>
                          <button
                            className={
                              "tool labeled " + (compare ? "is-on" : "")
                            }
                            aria-pressed={compare}
                            disabled={recording}
                            onClick={() => {
                              setCompare(!compare);
                              replay();
                            }}
                          >
                            <Layers3 size={14} />
                            <span>Compare</span>
                          </button>
                          <button
                            className={
                              "tool labeled " + (details ? "is-on" : "")
                            }
                            aria-expanded={details}
                            aria-controls="scene-details"
                            onClick={() => setDetails(!details)}
                          >
                            <SlidersHorizontal size={14} />
                            <span>Details</span>
                          </button>
                        </div>
                        {details && (
                          <section
                            className="scene-details"
                            id="scene-details"
                            aria-label="Scene details"
                          >
                            <header>
                              <h2>Details</h2>
                              <button
                                className="icon-button"
                                aria-label="Close details"
                                onClick={() => setDetails(false)}
                              >
                                <X size={15} />
                              </button>
                            </header>
                            <label className="field">
                              <span>
                                Replay time{" "}
                                <b>{paused ? fmt(time) + "s" : "Live"}</b>
                              </span>
                              <input
                                type="range"
                                min="0"
                                max="8"
                                step=".1"
                                value={time}
                                onChange={(e) => replay(Number(e.target.value))}
                              />
                            </label>
                            <div className="details-row">
                              <label className="field inline">
                                <span>Viewpoint</span>
                                <select
                                  value={camera}
                                  onChange={(e) =>
                                    replay(time, Number(e.target.value))
                                  }
                                >
                                  {[0, 1, 2].map((v) => (
                                    <option key={v} value={v}>
                                      View {v + 1}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <button
                                className="ghost-button"
                                onClick={() => replay(0, 0)}
                              >
                                <RotateCcw size={13} /> Reset
                              </button>
                              <button
                                className="ghost-button"
                                onClick={() =>
                                  viewport.current?.requestFullscreen?.()
                                }
                              >
                                <Maximize2 size={13} /> Fullscreen
                              </button>
                            </div>
                            <dl className="details-facts">
                              <div>
                                <dt>Live preview</dt>
                                <dd>
                                  {telemetry
                                    ? `${telemetry.calls.toLocaleString()} draw calls · ${telemetry.triangles.toLocaleString()} triangles`
                                    : "No telemetry reported"}
                                </dd>
                              </div>
                              <div>
                                <dt>Recorded interactions</dt>
                                <dd>
                                  {project.config?.autoInstrument
                                    ? scenarioCount
                                      ? `${scenarioCount} saved for replay`
                                      : "None saved"
                                    : "Needs automatic integration"}
                                </dd>
                              </div>
                              {selectedName && (
                                <div>
                                  <dt>Selected object</dt>
                                  <dd>
                                    {selectedName}
                                    {selectedObjectInfo?.type ||
                                    selectedObjectInfo?.geometryType
                                      ? " · " +
                                        (selectedObjectInfo.type ||
                                          selectedObjectInfo.geometryType)
                                      : ""}
                                    {selectedObjectInfo?.instances
                                      ? ` · ${selectedObjectInfo.instances} instances`
                                      : ""}
                                  </dd>
                                </div>
                              )}
                            </dl>
                            {selectedObjectInfo?.source && (
                              <button
                                className="ghost-button"
                                onClick={() =>
                                  inspectFile({
                                    path: selectedObjectInfo.source,
                                  })
                                }
                              >
                                <FileCode2 size={13} /> Related source
                              </button>
                            )}
                            <p className="fine-print">
                              Live preview numbers are for orientation only.
                              Patches are accepted from separate, uncontended
                              measurements.
                            </p>
                          </section>
                        )}
                      </>
                    ) : (
                      <div className="stage-empty">
                        {view === "welcome" ? (
                          <>
                            <h1>Your scene appears here.</h1>
                            <p>
                              Add a project above. Sift builds it and shows the
                              running app in this space.
                            </p>
                          </>
                        ) : view === "build-failed" ? (
                          <>
                            <TriangleAlert size={22} className="tone-error" />
                            <h1>The preview could not be built.</h1>
                            <p>{firstLine(run?.error || run?.phase)}</p>
                            <div className="button-row">
                              <button
                                className="primary-button"
                                disabled={busy || running}
                                onClick={() => launch("profile")}
                              >
                                Try again
                              </button>
                              <button
                                className="ghost-button"
                                onClick={() => setDrawer("logs")}
                              >
                                View build output
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <h1>{project.name}</h1>
                            <p>
                              The running app appears here after a first build
                              and baseline measurement.
                            </p>
                            <div className="button-row">
                              <button
                                className="primary-button"
                                disabled={busy || running}
                                onClick={() => launch("profile")}
                              >
                                {busy ? (
                                  <Loader2 className="spin" size={15} />
                                ) : (
                                  <ScanLine size={15} />
                                )}
                                Build preview
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </main>
                </section>
              </>
            )}
          </div>
        </>
      )}
      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {modal && (
        <div className="overlay" onClick={() => setModal(null)}>
          <section
            className={"dialog " + (modal === "help" ? "wide" : "")}
            role="dialog"
            aria-modal="true"
            aria-label={
              {
                settings: "Model settings",
                help: "Help",
                apply: "Apply accepted changes",
                capture: "WebGL capture",
              }[modal]
            }
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="dialog-close icon-button"
              autoFocus
              aria-label="Close dialog"
              onClick={() => setModal(null)}
            >
              <X size={18} />
            </button>
            {modal === "settings" ? (
              <Settings
                provider={data.provider}
                busy={busy}
                onSave={(body) =>
                  act(async () => {
                    await api("/settings", body);
                    setModal(null);
                    setNotice("Model connection saved locally.");
                  })
                }
              />
            ) : modal === "help" ? (
              <Help />
            ) : modal === "apply" ? (
              <>
                <h2>Apply the accepted change?</h2>
                <p>
                  Sift checks for conflicting edits and saves a backup before
                  writing the accepted source changes to:
                </p>
                <code className="project-path">{project?.original}</code>
                <div className="dialog-actions">
                  <button
                    className="secondary-button"
                    onClick={() => setModal(null)}
                  >
                    Keep reviewing
                  </button>
                  <button
                    className="primary-button"
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        const result = await api(
                          "/projects/" + project.id + "/apply",
                          {},
                        );
                        setModal(null);
                        setNotice(
                          `Applied ${result.files.length} file(s). A backup was saved at ${result.backup}`,
                        );
                      })
                    }
                  >
                    Apply <Check size={14} />
                  </button>
                </div>
              </>
            ) : modal === "capture" ? (
              <>
                <h2>Inside one frame</h2>
                <p>
                  {frameCapture?.commands?.toLocaleString()} WebGL commands,
                  including {frameCapture?.drawCommands?.toLocaleString()} draw
                  commands. Instrumentation runs separately from timing
                  benchmarks.
                </p>
                <a
                  className="primary-button full"
                  href={"/api/projects/" + project.id + "/capture"}
                  download
                >
                  <ArrowDownToLine size={15} /> Download compressed capture
                </a>
              </>
            ) : null}
          </section>
        </div>
      )}
      {drawer && (
        <div className="drawer-overlay" onClick={() => setDrawer(null)}>
          <section
            className="detail-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="drawer-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <h2 id="drawer-title">
                {
                  {
                    measurements: "Measurements",
                    logs: "Run details",
                    history: "Run history",
                    files: "Project source",
                    source: source?.path || "Source",
                    experiment: "The proposed change",
                    evidence: "Verification evidence",
                  }[drawer]
                }
              </h2>
              <button
                className="icon-button"
                autoFocus
                aria-label="Close panel"
                onClick={() => setDrawer(null)}
              >
                <X size={18} />
              </button>
            </header>
            <div className="drawer-body">
              {drawer === "measurements" ? (
                <Measurements baseline={baseline} best={best} run={run} />
              ) : drawer === "logs" ? (
                <>
                  <WorkerStatus worker={data.worker} />
                  {run ? (
                    <>
                      <div className="drawer-run-heading">
                        <Status value={run.status} />
                        <span>{run.id}</span>
                      </div>
                      {run.error && (
                        <div className="problem">
                          <TriangleAlert size={16} />
                          <p>{run.error}</p>
                        </div>
                      )}
                      <div className="event-log">
                        {run.events?.map((event, i) => (
                          <div key={i}>
                            <time>
                              {new Date(event.at).toLocaleTimeString()}
                            </time>
                            <span className={"log-type " + event.type}>
                              {event.type}
                            </span>
                            <p>{event.message}</p>
                          </div>
                        ))}
                      </div>
                      {run.buildLog && (
                        <details>
                          <summary>Production build output</summary>
                          <pre className="code-block">{run.buildLog}</pre>
                        </details>
                      )}
                    </>
                  ) : (
                    <Empty
                      title="No job to inspect yet."
                      text="Build a preview to collect a run record."
                    />
                  )}
                  <div className="capture-action">
                    <div>
                      <h3>WebGL command capture</h3>
                      <p>
                        Inspect a frame using Spector.js, separately from
                        performance measurements.
                      </p>
                    </div>
                    <button
                      className="secondary-button"
                      disabled={running || busy || !project?.built}
                      onClick={() =>
                        act(async () => {
                          setNotice("Capturing a WebGL frame…");
                          const result = await api(
                            "/projects/" + project.id + "/capture",
                            {},
                          );
                          setFrameCapture(result);
                          setDrawer(null);
                          setModal("capture");
                        })
                      }
                    >
                      <Layers3 size={14} /> Capture frame
                    </button>
                  </div>
                </>
              ) : drawer === "history" ? (
                <div className="run-list">
                  {projectRuns.length ? (
                    projectRuns.map((r) => (
                      <button
                        key={r.id}
                        className={run?.id === r.id ? "selected" : ""}
                        onClick={() => {
                          setRunId(r.id);
                          setExperimentId(null);
                          setCompare(false);
                          setDrawer(null);
                        }}
                      >
                        <div>
                          <span>
                            {r.kind === "optimize"
                              ? "Improvement"
                              : r.kind === "profile"
                                ? "Build & measure"
                                : "Verifier test"}
                          </span>
                          <Status value={r.status} />
                        </div>
                        <small>{new Date(r.createdAt).toLocaleString()}</small>
                        <p>{r.mission || r.phase}</p>
                      </button>
                    ))
                  ) : (
                    <Empty
                      title="Your history starts with a first build."
                      text="Each run keeps its measurements and experiment outcomes."
                    />
                  )}
                </div>
              ) : drawer === "files" ? (
                <>
                  <p className="drawer-description">
                    The scanner follows local source imports. The coding agent
                    can inspect the indexed project while protected integration
                    and verification files stay outside its edit scope.
                  </p>
                  <div className="source-tree">
                    {(files.length
                      ? files
                      : project?.config?.editableFiles?.map((path) => ({
                          path,
                        })) || []
                    ).map((file) => (
                      <button key={file.path} onClick={() => inspectFile(file)}>
                        <FileCode2 size={16} />
                        <span>
                          <b>{file.path}</b>
                          <small>
                            {file.imports?.length || 0} imports
                            {file.usesThree ? " · Three.js usage" : ""}
                            {file.bytes
                              ? " · " + (file.bytes / 1024).toFixed(1) + " KB"
                              : ""}
                          </small>
                        </span>
                        <ArrowUpRight size={14} />
                      </button>
                    ))}
                  </div>
                </>
              ) : drawer === "source" ? (
                <pre className="code-block numbered">
                  {source?.content?.split("\n").map((line, i) => (
                    <span key={i}>
                      <i>{i + 1}</i>
                      {line || " "}
                      <br />
                    </span>
                  ))}
                </pre>
              ) : drawer === "experiment" ? (
                <>
                  <ExperimentSelector
                    run={run}
                    value={experiment?.id}
                    onSelect={setExperimentId}
                  />
                  {experiment ? (
                    <>
                      <div className="drawer-run-heading">
                        <Status value={experiment.status} />
                        <span>{experiment.model || "Experiment"}</span>
                      </div>
                      <h3 className="experiment-title">
                        {experiment.title || "Analyzing source"}
                      </h3>
                      <span className="eyebrow">Hypothesis</span>
                      <p className="drawer-description">
                        {experiment.hypothesis || "Waiting for a proposal."}
                      </p>
                      <span className="eyebrow">Outcome</span>
                      <p className="drawer-description">
                        {experiment.reason ||
                          "The worker is evaluating this candidate."}
                      </p>
                      {experiment.verifier && run && (
                        <a
                          className="verifier-receipt"
                          href={
                            "/api/runs/" +
                            run.id +
                            "/experiments/" +
                            experiment.id +
                            "/verdict"
                          }
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ShieldCheck size={17} />
                          <span>
                            <b>Independent verifier receipt</b>
                            <small>
                              Inspect the sealed policy, decision, and evidence
                              hashes.
                            </small>
                          </span>
                          <ArrowUpRight size={14} />
                        </a>
                      )}
                      {experiment.diff ? (
                        <Diff text={experiment.diff} />
                      ) : (
                        <Empty
                          title="No source patch."
                          text={
                            experiment.notes ||
                            "A candidate patch will appear here when the agent proposes one."
                          }
                        />
                      )}
                    </>
                  ) : (
                    <Empty
                      title="No experiment yet."
                      text="Run an improvement to inspect its proposed source changes."
                    />
                  )}
                </>
              ) : drawer === "evidence" ? (
                <Evidence
                  run={run}
                  experiment={experiment}
                  onSelect={setExperimentId}
                />
              ) : null}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
function Note({ tone, children }) {
  return (
    <div
      className={"note " + (tone || "")}
      role={tone === "error" ? "alert" : undefined}
    >
      {tone === "error" && <TriangleAlert size={14} aria-hidden="true" />}
      <div>{children}</div>
    </div>
  );
}
function Menu({ label, hideLabel, icon: Icon, items }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null),
    trigger = useRef(null);
  useEffect(() => {
    if (!open) return;
    const entries = () => [
      ...root.current.querySelectorAll("[role=menuitem]:not(:disabled)"),
    ];
    entries()[0]?.focus();
    const down = (e) => {
      if (!root.current?.contains(e.target)) setOpen(false);
    };
    const key = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const list = entries();
        const at = list.indexOf(document.activeElement);
        list[
          (at + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length
        ]?.focus();
      }
    };
    document.addEventListener("pointerdown", down);
    root.current.addEventListener("keydown", key);
    const node = root.current;
    return () => {
      document.removeEventListener("pointerdown", down);
      node.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div className="menu" ref={root}>
      <button
        ref={trigger}
        className={hideLabel ? "icon-button" : "secondary-button"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={hideLabel ? label : undefined}
        title={hideLabel ? label : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {Icon && <Icon size={17} />}
        {!hideLabel && <span>{label}</span>}
      </button>
      {open && (
        <div className="menu-list" role="menu" aria-label={label}>
          {items.filter(Boolean).map((item, i) =>
            item === "-" ? (
              <hr key={i} />
            ) : item.href ? (
              <a
                key={i}
                role="menuitem"
                href={item.href}
                download
                onClick={() => setOpen(false)}
              >
                {item.label}
              </a>
            ) : (
              <button
                key={i}
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
              >
                {item.label}
                {item.hint && <small>{item.hint}</small>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
function Fact({ label, value }) {
  return (
    <div className="fact">
      <span>{label}</span>
      <b>{value || "—"}</b>
    </div>
  );
}
function Reading({ label, value, unit, before, optional }) {
  return (
    <div className="reading">
      <span>{label}</span>
      <b>
        {before && <del>{before}</del>}
        {before && <ArrowRight size={12} />} {optional ? "Unavailable" : value}
        <small>{optional ? "" : unit}</small>
      </b>
    </div>
  );
}
function CheckRow({ pass, title, text }) {
  return (
    <div className={"check-row " + (pass ? "passed" : "failed")}>
      <span>{pass ? <Check size={13} /> : <X size={13} />}</span>
      <div>
        <b>{title}</b>
        <p>{text}</p>
      </div>
    </div>
  );
}
function Measurements({ baseline, best, run }) {
  if (!baseline)
    return (
      <Empty
        title="A measurement comes first."
        text="Profile your project to collect a baseline on this machine."
      />
    );
  return (
    <>
      <p className="drawer-description">
        The reference and candidate run sequentially under the same configured
        workload. Preview telemetry is separate and is not used to accept a
        patch.
      </p>
      <div className="measurement-table">
        <div className="measurement-header">
          <span>MEASUREMENT</span>
          <span>REFERENCE</span>
          <span>CURRENT BEST</span>
        </div>
        {[
          ["CPU submission p95", "submitP95", "ms"],
          ["Frame interval p95", "frameP95", "ms"],
          ["Draw calls", "calls", ""],
          ["Triangles", "triangles", ""],
          ["GPU query p95", "gpuP95", "ms"],
        ].map(([label, key, unit]) => (
          <div key={key}>
            <span>{label}</span>
            <b>
              {Number.isFinite(baseline[key])
                ? unit
                  ? fmt(baseline[key], key === "gpuP95" ? 2 : 1)
                  : baseline[key].toLocaleString()
                : "Unavailable"}
              <small>{Number.isFinite(baseline[key]) ? unit : ""}</small>
            </b>
            <b>
              {Number.isFinite(best?.[key])
                ? unit
                  ? fmt(best[key], key === "gpuP95" ? 2 : 1)
                  : best[key].toLocaleString()
                : "Unavailable"}
              <small>{Number.isFinite(best?.[key]) ? unit : ""}</small>
            </b>
          </div>
        ))}
      </div>
      <div className="measurement-notes">
        <h3>Conditions & uncertainty</h3>
        <Fact label="Browser" value="Local headless Chrome" />
        <Fact
          label="Viewport"
          value={baseline.hardware?.viewport?.join(" × ") || "960 × 640"}
        />
        <Fact label="Pixel ratio" value={baseline.hardware?.dpr || 1} />
        <Fact label="Repeated samples" value={baseline.samples || 3} />
        <Fact label="Renderer" value={baseline.renderer || "Not reported"} />
        <Fact
          label="Selected goal"
          value={
            run?.metric === "drawCalls"
              ? "Draw calls, with CPU/frame pacing guards"
              : "CPU submission p95"
          }
        />
        <p>
          CPU submission is not GPU utilization. GPU timer queries are reported
          when available and may be noisy. One machine and one workload do not
          establish performance across devices.
        </p>
      </div>
      {run && (
        <a
          className="secondary-button"
          href={"/api/runs/" + run.id + "/report"}
          download
        >
          <ArrowDownToLine size={14} /> Download evidence report
        </a>
      )}
    </>
  );
}
function WorkerStatus({ worker }) {
  return (
    <div className="worker-status">
      <span
        className={"tiny-dot " + (worker?.alive === false ? "offline" : "")}
      />
      <div>
        <b>
          {worker?.alive === false
            ? "Worker is offline"
            : "Independent local worker"}
        </b>
        <small>
          {worker?.heartbeat
            ? "Last heartbeat " +
              new Date(worker.heartbeat).toLocaleTimeString()
            : "Jobs and measurements are stored locally."}
          {Number.isFinite(worker?.queue)
            ? " · " + worker.queue + " queued"
            : ""}
        </small>
      </div>
    </div>
  );
}
function Settings({ provider, onSave, busy }) {
  const [model, setModel] = useState(provider.model || "gpt-5.4-mini"),
    [baseUrl, setBase] = useState(
      provider.baseUrl || "https://api.openai.com/v1",
    ),
    [apiKey, setKey] = useState(""),
    [protocol, setProtocol] = useState(provider.protocol || "responses");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ model, baseUrl, apiKey, protocol });
      }}
    >
      <span className="dialog-symbol">
        <Settings2 size={24} strokeWidth={1.4} />
      </span>
      <span className="overline">MODEL CONNECTION</span>
      <h2>A model for the work.</h2>
      <p>
        Credentials stay in the local backend. The scene preview never receives
        your API key.
      </p>
      <label>
        API key
        <span className="label-note">
          {provider.configured
            ? "Configured · leave blank to keep"
            : "Required for optimization"}
        </span>
        <input
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setKey(e.target.value)}
          placeholder={
            provider.configured ? "••••••••••••••••" : "Enter API key"
          }
        />
      </label>
      <label>
        Protocol
        <select value={protocol} onChange={(e) => setProtocol(e.target.value)}>
          <option value="responses">OpenAI Responses</option>
          <option value="chat-completions">Compatible Chat Completions</option>
        </select>
      </label>
      <label>
        Model
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          required
        />
      </label>
      <label>
        API base URL
        <input
          type="url"
          value={baseUrl}
          onChange={(e) => setBase(e.target.value)}
          required
        />
      </label>
      <p className="form-note">
        Runs are bounded by experiment and token limits. Provider usage charges
        apply.
      </p>
      <button type="submit" className="primary-button full" disabled={busy}>
        Save connection
        <ArrowRight size={15} />
      </button>
    </form>
  );
}
function Help() {
  const [text, setText] = useState("Loading documentation…");
  useEffect(() => {
    fetch("/api/help")
      .then((r) => r.text())
      .then(setText)
      .catch(() => setText("Could not load the local documentation."));
  }, []);
  return (
    <>
      <span className="overline">PROJECT INTEGRATION</span>
      <h2>A useful connection.</h2>
      <pre className="help-text">{text}</pre>
    </>
  );
}
createRoot(document.getElementById("root")).render(<App />);
