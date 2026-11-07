import React, { Suspense, lazy, useEffect, useRef, useState } from "react";
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
import Loading from "./Loading.jsx";
import "./style.css";
// The home page carries the WebGL backdrop, so it loads separately.
const Home = lazy(() => import("./Home.jsx"));
const Dashboard = lazy(() => import("./Dashboard.jsx"));
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
    [home, setHome] = useState(false),
    [tab, setTab] = useState("scene");
  const preview = useRef(null),
    reference = useRef(null),
    viewport = useRef(null),
    activityList = useRef(null),
    recordingRef = useRef(false),
    recordedRef = useRef([]),
    recordStart = useRef(0),
    lastActiveRun = useRef(null),
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
  const showHome = !project || home;
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
    if (projectJob && lastActiveRun.current !== projectJob.id) {
      setRunId(projectJob.id);
      setExperimentId(null);
      setCompare(false);
      lastActiveRun.current = projectJob.id;
    }
  }, [projectJob?.id]);
  // A finished improvement opens the results dashboard.
  useEffect(() => {
    const previous = prevJob.current;
    if (projectJob) {
      prevJob.current = projectJob.id;
      return;
    }
    if (!previous) return;
    prevJob.current = null;
    const finished = data.runs.find((r) => r.id === previous);
    if (
      finished?.kind === "optimize" &&
      terminalStatuses.includes(finished.status)
    ) {
      setRunId(previous);
      setExperimentId(null);
      setTab("results");
    }
  }, [projectJob?.id, data.runs]);
  // A goal typed on the home page starts the improvement once the first build lands.
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
      if (!goal.trim()) return;
      if (data.provider.configured) launch("optimize", goal);
      else setNotice("Preview ready. Connect a model to run your improvement.");
    } else if (terminalStatuses.includes(first.status)) autoRun.current = null;
  }, [data, busy]);
  // Scroll only the rail's own list; on narrow screens the page itself scrolls.
  useEffect(() => {
    const list = activityList.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [activityRun?.id, activityEvents.length, view]);
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
      await fn();
      await refresh();
    } catch (e) {
      setNotice(e.message);
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
    setHome(false);
    setTab("scene");
  }
  async function example(name) {
    await act(async () => {
      const p = await api("/examples/" + name, {});
      if (mission.trim()) {
        try {
          localStorage.setItem("earl:mission:" + p.id, mission);
        } catch {}
      }
      chooseProject(p.id);
      setModal(null);
      if (!p.built) {
        const r = await api("/projects/" + p.id + "/runs", { kind: "profile" });
        setRunId(r.id);
      }
    });
  }
  function connectProject({ mission: goal, ...body }) {
    return act(async () => {
      const p = await api("/projects", body);
      const text = (goal ?? mission).trim();
      if (text) {
        try {
          localStorage.setItem("earl:mission:" + p.id, text);
        } catch {}
      }
      if (goal?.trim()) autoRun.current = p.id;
      chooseProject(p.id);
      setModal(null);
      await refresh();
      try {
        const firstRun = await api("/projects/" + p.id + "/runs", {
          kind: "profile",
        });
        setRunId(firstRun.id);
        setNotice(
          "Project connected. Building your first preview automatically.",
        );
      } catch (error) {
        setNotice(
          "Project connected, but its preview could not start: " +
            error.message,
        );
      }
    });
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
    if (!project) return setModal("connect");
    if (kind === "optimize" && !data.provider.configured)
      return setModal("settings");
    await act(async () => {
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
    <div className={"app " + (showHome ? "is-home" : "")}>
      {showHome ? (
        <div inert={modal || drawer ? true : undefined}>
          <Suspense fallback={<div className="home" />}>
            <Home
              projects={data.projects}
              busy={busy}
              onInspect={(path) => api("/inspect", { path })}
              onConnect={connectProject}
              onExample={example}
              onOpenProject={chooseProject}
              onSettings={() => setModal("settings")}
              onHelp={() => setModal("help")}
            />
          </Suspense>
        </div>
      ) : (
        <>
          <header className="topbar" inert={modal || drawer ? true : undefined}>
            <a
              href="./"
              className="wordmark"
              aria-label="Sift home"
              onClick={(e) => {
                e.preventDefault();
                setHome(true);
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
            {project && (
              <nav className="tabs" aria-label="Views">
                <button
                  aria-current={tab === "scene" ? "page" : undefined}
                  onClick={() => setTab("scene")}
                >
                  Scene
                </button>
                <button
                  aria-current={tab === "results" ? "page" : undefined}
                  disabled={!dashRun}
                  title={dashRun ? undefined : "Build a preview first"}
                  onClick={() => setTab("results")}
                >
                  Results
                </button>
              </nav>
            )}
            <div className="topbar-end">
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
                    label: "Connect project…",
                    onClick: () => setModal("connect"),
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
          {projectJob ? (
            <Loading
              inert={modal || drawer ? true : undefined}
              job={projectJob}
              project={project}
              goal={mission}
              baselineSrc={
                projectJob.baseline && failedBaseline !== projectJob.id
                  ? "/api/runs/" + projectJob.id + "/baseline/baseline-0.png"
                  : null
              }
              stopping={busy}
              onStop={() => act(() => api("/stop", { runId: projectJob.id }))}
              onLog={() => setDrawer("logs")}
            />
          ) : tab === "results" && dashRun ? (
            <Suspense fallback={<div className="dash" />}>
              <Dashboard
                inert={modal || drawer ? true : undefined}
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
                onScene={() => setTab("scene")}
                onCompare={() => {
                  setTab("scene");
                  setCompare(true);
                }}
                onApply={() => setModal("apply")}
                onLogs={() => setDrawer("logs")}
              />
            </Suspense>
          ) : (
            <div
              className="workspace"
              inert={modal || drawer ? true : undefined}
            >
              <main
                className={"stage " + (compare ? "is-comparing" : "")}
                ref={viewport}
                aria-label="Project scene"
              >
                {projectJob || view === "elsewhere" ? (
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
                          "tool labeled " + (recording ? "is-recording" : "")
                        }
                        disabled={!canRecord && !recording}
                        onClick={record}
                        title={
                          !project.config?.autoInstrument
                            ? "Recording needs the automatic integration"
                            : "Record actions for replay checks"
                        }
                      >
                        {recording ? <Square size={11} /> : <Radio size={14} />}
                        <span>{recording ? "Stop & save" : "Record"}</span>
                      </button>
                      <button
                        className={"tool labeled " + (compare ? "is-on" : "")}
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
                        className={"tool labeled " + (details ? "is-on" : "")}
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
                              inspectFile({ path: selectedObjectInfo.source })
                            }
                          >
                            <FileCode2 size={13} /> Related source
                          </button>
                        )}
                        <p className="fine-print">
                          Live preview numbers are for orientation only. Patches
                          are accepted from separate, uncontended measurements.
                        </p>
                      </section>
                    )}
                  </>
                ) : (
                  <div className="stage-empty">
                    {view === "welcome" ? (
                      <>
                        <h1>Your scene goes here.</h1>
                        <p>
                          Connect a local Vite + Three.js project, or try one of
                          the included examples.
                        </p>
                        <div className="button-row">
                          <button
                            className="primary-button"
                            onClick={() => setModal("connect")}
                          >
                            Connect project <ArrowRight size={15} />
                          </button>
                          <button
                            className="ghost-button"
                            disabled={busy || running}
                            onClick={() => example("warehouse")}
                          >
                            Try the warehouse example
                          </button>
                        </div>
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
                          The running app appears here after a first build and
                          baseline measurement.
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
              <aside className="rail" aria-label="Sift activity">
                <div className="rail-status">
                  <ol className="steps" aria-label="Progress">
                    {steps.map((label, i) => (
                      <li
                        key={label}
                        className={
                          i === stepIndex
                            ? "current"
                            : i < stepIndex && stepIndex !== 0
                              ? "done"
                              : ""
                        }
                        aria-current={i === stepIndex ? "step" : undefined}
                      >
                        {label}
                      </li>
                    ))}
                  </ol>
                  <h2 aria-live="polite">
                    {liveStatuses.includes(projectJob?.status) &&
                      view !== "queued" && (
                        <Loader2
                          className="spin"
                          size={15}
                          aria-hidden="true"
                        />
                      )}
                    {status.title}
                  </h2>
                  {status.text && <p>{status.text}</p>}
                </div>
                <div
                  className="activity"
                  aria-label="Run activity"
                  ref={activityList}
                >
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
                      {Array.isArray(discovery.issues) &&
                        discovery.issues.slice(0, 2).map((issue, i) => (
                          <span key={i} className="note-line">
                            {typeof issue === "string"
                              ? issue
                              : issue.message || issue.detail || issue.code}
                          </span>
                        ))}
                    </Note>
                  )}
                  {view === "welcome" && (
                    <div className="starter-list">
                      {[
                        [
                          "warehouse",
                          "Warehouse robotics",
                          "1,600 moving objects",
                        ],
                        ["fleet", "Circular fleet", "800 moving objects"],
                        ["assembly", "Assembly floor", "1,200 moving objects"],
                      ].map(([id, title, detail]) => (
                        <button
                          key={id}
                          disabled={busy || running}
                          onClick={() => example(id)}
                        >
                          <span>
                            <b>{title}</b>
                            <small>{detail}</small>
                          </span>
                          <ArrowUpRight size={14} />
                        </button>
                      ))}
                    </div>
                  )}
                  {activityRun && (
                    <div className="activity-run">
                      <div className="activity-heading">
                        <span>
                          {activityRun.kind === "optimize"
                            ? "Improvement run"
                            : activityRun.kind === "profile"
                              ? "Build & measure"
                              : "Verifier test"}
                          {" · "}
                          {new Date(activityRun.createdAt).toLocaleTimeString(
                            [],
                            {
                              hour: "numeric",
                              minute: "2-digit",
                            },
                          )}
                        </span>
                        {projectRuns.length > 1 && (
                          <button onClick={() => setDrawer("history")}>
                            History
                          </button>
                        )}
                      </div>
                      {activityRun.mission && (
                        <p className="activity-goal">{activityRun.mission}</p>
                      )}
                      <ol className="events">
                        {activityEvents.map((event, i) => (
                          <li key={i} className={"event " + event.type}>
                            <i aria-hidden="true" />
                            <p>{event.message}</p>
                            <time dateTime={event.at}>
                              {new Date(event.at).toLocaleTimeString([], {
                                hour: "numeric",
                                minute: "2-digit",
                                second: "2-digit",
                              })}
                            </time>
                          </li>
                        ))}
                        {!activityEvents.length && (
                          <li className="event">
                            <i aria-hidden="true" />
                            <p>{activityRun.phase || "Waiting to start"}</p>
                          </li>
                        )}
                      </ol>
                      {projectJob && (
                        <button
                          className="link-button"
                          onClick={() => setDrawer("logs")}
                        >
                          Full log <ChevronRight size={12} />
                        </button>
                      )}
                    </div>
                  )}
                  {view === "ready" && baseline && run?.kind === "profile" && (
                    <div className="finding">
                      <span className="eyebrow">Baseline on this machine</span>
                      <dl>
                        <div>
                          <dt>Draw calls</dt>
                          <dd>{baseline.calls?.toLocaleString() ?? "—"}</dd>
                        </div>
                        <div>
                          <dt>CPU submit p95</dt>
                          <dd>{fmt(baseline.submitP95)} ms</dd>
                        </div>
                        <div>
                          <dt>Frame p95</dt>
                          <dd>{fmt(baseline.frameP95)} ms</dd>
                        </div>
                      </dl>
                      <button
                        className="link-button"
                        onClick={() => setDrawer("measurements")}
                      >
                        Conditions & all measurements <ChevronRight size={12} />
                      </button>
                    </div>
                  )}
                  {(view === "attention" || view === "build-failed") && (
                    <Note tone="error">
                      {firstLine(run?.error || run?.phase)}
                      <button
                        className="link-button"
                        onClick={() => setDrawer("logs")}
                      >
                        Open error details <ChevronRight size={12} />
                      </button>
                    </Note>
                  )}
                  {resultRun && (
                    <ResultCard
                      run={resultRun}
                      experiment={resultExperiment}
                      verdict={verdict}
                      acceptedCount={accepted.length}
                      isWorkspace={resultIsWorkspace}
                      compare={compare}
                      busy={busy}
                      project={project}
                      onCompare={() => {
                        setCompare(!compare);
                        replay();
                      }}
                      onCode={() => openResult("experiment")}
                      onEvidence={() => openResult("evidence")}
                      onLogs={() => setDrawer("logs")}
                      onApply={() => setModal("apply")}
                      onShowWorkspaceRun={() => {
                        setRunId(project.lastAcceptedRun);
                        setExperimentId(null);
                      }}
                    />
                  )}
                </div>
                <form
                  className="composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!running && !busy) launch("optimize");
                  }}
                >
                  <label htmlFor="earl-mission">What feels slow?</label>
                  <textarea
                    id="earl-mission"
                    rows={3}
                    placeholder="It stutters when more robots are on screen. Keep it looking and behaving the same."
                    value={mission}
                    maxLength={4000}
                    onChange={(e) => updateMission(e.target.value)}
                    disabled={running || busy || !project}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                        e.preventDefault();
                        if (!running && !busy) launch("optimize");
                      }
                    }}
                  />
                  {project && !data.provider.configured && !running && (
                    <p className="composer-note">
                      Improvements need a model connection.{" "}
                      <button
                        type="button"
                        onClick={() => setModal("settings")}
                      >
                        Set up model
                      </button>
                    </p>
                  )}
                  <div className="composer-actions">
                    {projectJob ? (
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={busy}
                        onClick={() =>
                          act(() => api("/stop", { runId: projectJob.id }))
                        }
                      >
                        <Square size={11} /> Stop
                      </button>
                    ) : (
                      <label className="attempts">
                        <span className="visually-hidden">Attempt limit</span>
                        <select
                          value={count}
                          onChange={(e) => setCount(Number(e.target.value))}
                          disabled={running}
                        >
                          {[1, 2, 3, 5].map((n) => (
                            <option key={n} value={n}>
                              {n} attempt{n === 1 ? "" : "s"}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <button
                      className="primary-button"
                      type="submit"
                      disabled={running || busy || (project && !project.built)}
                      title={
                        project && !project.built
                          ? "Build a preview first"
                          : undefined
                      }
                    >
                      {busy ? <Loader2 className="spin" size={15} /> : null}
                      {project ? "Improve performance" : "Connect a project"}
                    </button>
                  </div>
                </form>
              </aside>
            </div>
          )}
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
                connect: "Connect project",
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
            {modal === "connect" ? (
              <Connect
                busy={busy}
                onExample={example}
                onConnect={connectProject}
              />
            ) : modal === "settings" ? (
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
function ResultCard({
  run,
  experiment,
  verdict,
  acceptedCount,
  isWorkspace,
  compare,
  busy,
  project,
  onCompare,
  onCode,
  onEvidence,
  onLogs,
  onApply,
  onShowWorkspaceRun,
}) {
  const before = experiment?.reference,
    after = experiment?.candidate;
  const rows = before
    ? [
        ["Draw calls", "calls", 0, ""],
        ["CPU submit p95", "submitP95", 1, " ms"],
        ["Frame p95", "frameP95", 1, " ms"],
      ]
    : [];
  const value = (summary, key, digits, unit) =>
    !Number.isFinite(summary?.[key])
      ? "—"
      : (digits
          ? summary[key].toFixed(digits)
          : summary[key].toLocaleString()) + unit;
  const good = verdict === "accepted";
  return (
    <section
      className={"result-card " + (good ? "is-accepted" : "is-" + verdict)}
      aria-label="Run result"
    >
      <header>
        <span className={"verdict " + verdict}>
          {good ? <Check size={13} /> : <X size={13} />}
          {
            {
              accepted:
                acceptedCount > 1
                  ? `${acceptedCount} changes accepted`
                  : "Accepted",
              rejected: "Rejected",
              inconclusive: "Inconclusive",
              failed: "Failed",
              stopped: "Stopped",
              interrupted: "Interrupted",
              "no-attempt": "No candidate",
            }[verdict]
          }
        </span>
        {run.metric && (
          <small>
            Target:{" "}
            {run.metric === "drawCalls" ? "draw calls" : "CPU submission p95"}
          </small>
        )}
      </header>
      {experiment?.title && <h3>{experiment.title}</h3>}
      {!good && (
        <p className="result-reason">
          {experiment?.reason ||
            run.error ||
            run.phase ||
            "No candidate passed the checks."}{" "}
          Your project is unchanged.
        </p>
      )}
      {rows.length > 0 && (
        <table className="result-table">
          <thead>
            <tr>
              <th scope="col">
                <span className="visually-hidden">Measurement</span>
              </th>
              <th scope="col">Before</th>
              <th scope="col">{good ? "After" : "Candidate"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, key, digits, unit]) => (
              <tr key={key}>
                <th scope="row">{label}</th>
                <td>{value(before, key, digits, unit)}</td>
                <td>{value(after, key, digits, unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {good && !isWorkspace && project?.lastAcceptedRun && (
        <p className="result-reason">
          A later accepted change is now the current workspace.{" "}
          <button className="link-button" onClick={onShowWorkspaceRun}>
            Show that run
          </button>
        </p>
      )}
      {!good &&
        project?.lastAcceptedRun &&
        project.lastAcceptedRun !== run.id && (
          <p className="result-reason">
            An earlier accepted change is still in your workspace.{" "}
            <button className="link-button" onClick={onShowWorkspaceRun}>
              Review it
            </button>
          </p>
        )}
      <div className="result-actions">
        {good && isWorkspace && (
          <button
            className={"secondary-button " + (compare ? "is-on" : "")}
            aria-pressed={compare}
            onClick={onCompare}
          >
            <Layers3 size={14} /> Compare
          </button>
        )}
        {experiment && (
          <button className="secondary-button" onClick={onCode}>
            <Code2 size={14} /> View code
          </button>
        )}
        {good && isWorkspace && (
          <button className="primary-button" disabled={busy} onClick={onApply}>
            Apply <ArrowRight size={14} />
          </button>
        )}
      </div>
      <details className="result-more">
        <summary>Evidence, receipt & logs</summary>
        <div>
          {experiment?.guards && (
            <button className="link-button" onClick={onEvidence}>
              Verification images & checks <ChevronRight size={12} />
            </button>
          )}
          {experiment?.verifier && (
            <a
              className="link-button"
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
              Verifier receipt <ArrowUpRight size={12} />
            </a>
          )}
          <button className="link-button" onClick={onLogs}>
            Full run log <ChevronRight size={12} />
          </button>
          <a
            className="link-button"
            href={"/api/runs/" + run.id + "/report"}
            download
          >
            Download run report <ArrowDownToLine size={12} />
          </a>
          {good && isWorkspace && (
            <a
              className="link-button"
              href={"/api/projects/" + project.id + "/patch"}
              download
            >
              Export patch <ArrowDownToLine size={12} />
            </a>
          )}
          {run.experiments?.length > 1 && (
            <ol className="attempt-list">
              {run.experiments.map((e, i) => (
                <li key={e.id}>
                  <span>{i + 1}.</span> {e.title || "Untitled attempt"}{" "}
                  <Status value={e.status} />
                </li>
              ))}
            </ol>
          )}
          <p className="fine-print">
            Checks cover the configured workload and recorded interactions. They
            do not prove every possible application state.
          </p>
        </div>
      </details>
    </section>
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
function Connect({ onConnect, onExample, busy }) {
  const [path, setPath] = useState(""),
    [trusted, setTrusted] = useState(false),
    [discovery, setDiscovery] = useState(null),
    [scanning, setScanning] = useState(false),
    [error, setError] = useState("");
  async function scan() {
    setScanning(true);
    setError("");
    try {
      setDiscovery(await api("/inspect", { path }));
    } catch (e) {
      setError(e.message);
      setDiscovery(null);
    } finally {
      setScanning(false);
    }
  }
  return (
    <>
      <span className="dialog-symbol">
        <Box size={25} strokeWidth={1.4} />
      </span>
      <span className="overline">CONNECT YOUR PROJECT</span>
      <h2>Open your project.</h2>
      <p>
        Point Sift at a local project. It will inspect the framework, entry
        points, dependencies, and build setup before connecting. Vite + Three.js
        projects are the supported starting point. No ZIP or adapter required.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onConnect({ path, trusted });
        }}
      >
        <label>
          Project folder
          <div className="path-field">
            <input
              placeholder="/path/to/your/three-scene"
              value={path}
              onChange={(e) => {
                setPath(e.target.value);
                setDiscovery(null);
              }}
              required
            />
            <button type="button" disabled={!path || scanning} onClick={scan}>
              {scanning ? (
                <Loader2 size={14} className="spin" />
              ) : (
                <ScanLine size={14} />
              )}{" "}
              Inspect
            </button>
          </div>
        </label>
        {error && (
          <div className="problem">
            <TriangleAlert size={14} />
            {error}
          </div>
        )}
        {discovery && (
          <div className="inspected-project">
            <header>
              <Check size={15} />
              <b>{discovery.name || "Project inspected"}</b>
            </header>
            <Fact label="Framework" value={discovery.framework} />
            <Fact
              label="Three.js"
              value={discovery.threeVersion || "Not detected"}
            />
            <Fact
              label="Entry points"
              value={discovery.entryPoints?.join(", ") || "Not detected"}
            />
            {discovery.issues?.map((issue, i) => (
              <p key={i}>
                {typeof issue === "string"
                  ? issue
                  : issue.message || issue.detail}
              </p>
            ))}
          </div>
        )}
        <label className="checkbox">
          <input
            type="checkbox"
            checked={trusted}
            onChange={(e) => setTrusted(e.target.checked)}
          />
          <span>
            I trust this project's code and build setup. Only connect projects I
            am allowed to run.
          </span>
        </label>
        <button
          type="submit"
          className="primary-button full"
          disabled={
            !trusted || busy || scanning || discovery?.supported === false
          }
        >
          Connect project
          <ArrowRight size={15} />
        </button>
      </form>
      <div className="dialog-divider">OR START WITH A WORKLOAD</div>
      {[
        ["warehouse", "Warehouse robotics", "1,600 moving objects"],
        ["fleet", "Circular fleet", "800 moving objects"],
        ["assembly", "Assembly floor", "1,200 moving objects"],
      ].map(([id, title, detail]) => (
        <button
          className="example-option"
          key={id}
          disabled={busy}
          onClick={() => onExample(id)}
        >
          <Box size={17} />
          <span>
            <b>{title}</b>
            <small>{detail}</small>
          </span>
          <ArrowUpRight size={14} />
        </button>
      ))}
    </>
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
