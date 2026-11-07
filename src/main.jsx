import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Box,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Code2,
  Cpu,
  FileCode2,
  Focus,
  GitBranch,
  HelpCircle,
  Layers3,
  Loader2,
  Maximize2,
  Pause,
  Play,
  Plus,
  Radio,
  RotateCcw,
  ScanLine,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal,
  TriangleAlert,
  X,
} from "lucide-react";
import "./style.css";
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "—");
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
function App() {
  const [data, setData] = useState({ projects: [], runs: [], provider: {} }),
    [projectId, setProjectId] = useState(() => {
      try {
        return localStorage.getItem("frameshift:project") || "";
      } catch {
        return "";
      }
    }),
    [stage, setStage] = useState("diagnose"),
    [runId, setRunId] = useState(null),
    [experimentId, setExperimentId] = useState(null),
    [modal, setModal] = useState(null),
    [drawer, setDrawer] = useState(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [connectionError, setConnectionError] = useState(""),
    [paused, setPaused] = useState(false),
    [compare, setCompare] = useState(false),
    [time, setTime] = useState(0),
    [camera, setCamera] = useState(0),
    [telemetry, setTelemetry] = useState(null),
    [objects, setObjects] = useState([]),
    [selectedObject, setSelectedObject] = useState(null),
    [count, setCount] = useState(2),
    [recording, setRecording] = useState(false),
    [recorded, setRecorded] = useState([]),
    [source, setSource] = useState(null),
    [frameCapture, setFrameCapture] = useState(null);
  const preview = useRef(null),
    reference = useRef(null),
    viewport = useRef(null),
    recordingRef = useRef(false),
    recordedRef = useRef([]),
    recordStart = useRef(0),
    lastStageRun = useRef(null);
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
  const experiment =
    run?.experiments?.find((e) => e.id === experimentId) ||
    run?.experiments?.findLast((e) => e.guards) ||
    run?.experiments?.at(-1);
  const accepted =
    run?.experiments?.filter((e) => e.status === "accepted") || [];
  const latestAcceptedRun = projectRuns.find((r) =>
    r.experiments?.some((e) => e.status === "accepted"),
  );
  const lastAccepted = latestAcceptedRun?.experiments?.findLast(
    (e) => e.status === "accepted",
  );
  const baseline = run?.baseline,
    best = run?.best || baseline;
  const discovery = project?.discovery || {};
  const files = Array.isArray(discovery.files) ? discovery.files : [];
  const isThisRunActive = Boolean(
    active && project && active.projectId === project.id,
  );
  const scenarioCount =
    project?.config?.scenario?.events?.length ||
    project?.scenario?.events?.length ||
    recorded.length;
  useEffect(() => {
    if (!project) return;
    try {
      localStorage.setItem("frameshift:project", project.id);
    } catch {}
    setTelemetry(null);
    setObjects([]);
    setSelectedObject(null);
    setCompare(false);
    setTime(0);
    setRecording(false);
    recordingRef.current = false;
    recordedRef.current = [];
    setRecorded([]);
  }, [project?.id]);
  useEffect(() => {
    if (
      active &&
      project &&
      active.projectId === project.id &&
      active.kind === "optimize"
    ) {
      if (lastStageRun.current !== active.id) {
        setStage("optimize");
        setRunId(active.id);
        lastStageRun.current = active.id;
      }
    }
  }, [active?.id, project?.id]);
  useEffect(() => {
    if (!modal && !drawer) return;
    const close = (e) => {
      if (e.key === "Escape") {
        setModal(null);
        setDrawer(null);
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [modal, drawer]);
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
    setProjectId(id);
    setRunId(null);
    setExperimentId(null);
    setStage("diagnose");
  }
  async function example(name) {
    await act(async () => {
      const p = await api("/examples/" + name, {});
      chooseProject(p.id);
      setModal(null);
      if (!p.built) {
        const r = await api("/projects/" + p.id + "/runs", { kind: "profile" });
        setRunId(r.id);
      }
    });
  }
  async function launch(kind) {
    if (!project) return setModal("connect");
    if (kind === "optimize" && !data.provider.configured)
      return setModal("settings");
    await act(async () => {
      setCompare(false);
      setExperimentId(null);
      const r = await api("/projects/" + project.id + "/runs", { kind, count });
      setRunId(r.id);
      setStage(kind === "optimize" ? "optimize" : "diagnose");
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
  function selectObject(object) {
    setSelectedObject(object);
    send({
      type: "frameshift:select",
      id: typeof object === "string" ? object : object.id,
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
  const primary =
    stage === "diagnose"
      ? {
          label: baseline ? "Profile again" : "Profile scene",
          icon: ScanLine,
          click: () => launch("profile"),
        }
      : stage === "optimize"
        ? {
            label: "Start optimization",
            icon: Sparkles,
            click: () => launch("optimize"),
          }
        : {
            label: "Apply accepted patch",
            icon: CheckCheck,
            click: () => setModal("apply"),
          };
  const selectedObjectInfo =
    typeof selectedObject === "object"
      ? selectedObject
      : objects.find((o) => String(o.id) === String(selectedObject));
  return (
    <div className="studio">
      <header
        className="studio-header"
        inert={modal || drawer ? true : undefined}
      >
        <a
          href="#"
          className="wordmark"
          aria-label="FrameShift home"
          onClick={(e) => {
            e.preventDefault();
            setStage("diagnose");
          }}
        >
          <span className="wordmark-symbol">
            <Layers3 size={23} strokeWidth={1.5} />
          </span>
          frameshift<span className="wordmark-dot">.</span>
        </a>
        <span className="header-divider" />
        <div className="project-switch">
          <Box size={15} />
          <div>
            <select
              aria-label="Active project"
              value={project?.id || ""}
              onChange={(e) => chooseProject(e.target.value)}
            >
              {!project && <option value="">Your first project</option>}
              {data.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <span>
              {project
                ? `${discovery.framework || "Three.js"}${discovery.threeVersion ? " · " + discovery.threeVersion : ""}`
                : "A clearer path to a better frame"}
            </span>
          </div>
          <ChevronDown size={12} />
        </div>
        <nav className="stage-nav" aria-label="Optimization stages">
          {[
            ["diagnose", "01", "Diagnose"],
            ["optimize", "02", "Optimize"],
            ["review", "03", "Review"],
          ].map(([id, num, label]) => (
            <button
              key={id}
              aria-current={stage === id ? "step" : undefined}
              onClick={() => setStage(id)}
            >
              <span>{num}</span>
              {label}
              {id === "review" && accepted.length > 0 && <i />}
            </button>
          ))}
        </nav>
        <div className="header-actions">
          <span className={"connection " + (connectionError ? "offline" : "")}>
            <i />
            {connectionError
              ? "Runner offline"
              : data.worker?.alive === false
                ? "Worker offline"
                : "Local runner"}
          </span>
          <button
            className="icon-button"
            aria-label="Model settings"
            title="Model settings"
            onClick={() => setModal("settings")}
          >
            <Settings2 size={17} />
          </button>
          <button className="small-button" onClick={() => setModal("connect")}>
            <Plus size={14} />
            <span>Connect project</span>
          </button>
        </div>
      </header>
      <div className="workspace" inert={modal || drawer ? true : undefined}>
        <main className="canvas-area">
          <div className="canvas-heading">
            <div>
              <span className="overline">
                {stage === "diagnose"
                  ? "YOUR SCENE, UNDERSTOOD"
                  : stage === "optimize"
                    ? "ONE CHANGE AT A TIME"
                    : "MEASURED. THEN REVIEWED."}
              </span>
              <h1>{project?.name || "A better frame starts here."}</h1>
            </div>
            <div className="canvas-heading-right">
              {project && (
                <span className="revision">
                  <GitBranch size={12} />
                  {project.lastAcceptedExperiment
                    ? "Accepted workspace"
                    : "Reference workspace"}
                </span>
              )}
              <button
                className="icon-button"
                aria-label="Open documentation"
                title="Documentation"
                onClick={() => setModal("help")}
              >
                <HelpCircle size={17} />
              </button>
            </div>
          </div>
          <section
            className={"viewport " + (compare ? "is-comparing" : "")}
            ref={viewport}
            aria-label="Project scene"
          >
            {running ? (
              <div className="run-cover">
                <div className="run-orbit">
                  <ScanLine size={27} />
                </div>
                <span className="overline">
                  {active?.status === "queued"
                    ? "QUEUED FOR THE LOCAL WORKER"
                    : "INDEPENDENT WORKER / " + active?.kind?.toUpperCase()}
                </span>
                <h2>{active?.phase || "Preparing your project"}</h2>
                <p>
                  {active?.status === "queued"
                    ? "The job is saved and will start when the worker is available."
                    : "The scene is paused while the worker builds, measures, and checks the project."}
                </p>
                <button
                  className="subtle-button"
                  onClick={() => setDrawer("logs")}
                >
                  <Terminal size={13} /> View run details
                  <ArrowRight size={13} />
                </button>
              </div>
            ) : project?.built ? (
              <>
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
                  <iframe
                    sandbox="allow-scripts"
                    ref={reference}
                    src={"/baseline/" + project.id + "/index.html"}
                    title="Reference project scene"
                    onLoad={() => replay()}
                  />
                )}
                <div className="scene-labels">
                  <span>
                    {compare
                      ? "CURRENT WORKSPACE"
                      : "PERSPECTIVE " + String(camera + 1).padStart(2, "0")}
                  </span>
                  <span>
                    {compare
                      ? "REFERENCE SNAPSHOT"
                      : discovery.framework || "THREE.JS / WEBGL"}
                  </span>
                </div>
                {selectedObject && (
                  <div className="selection-chip">
                    <Box size={12} />
                    {typeof selectedObject === "object"
                      ? selectedObject.name || selectedObject.id
                      : selectedObject}
                    <button
                      aria-label="Clear object selection"
                      onClick={() => {
                        setSelectedObject(null);
                        send({ type: "frameshift:select", id: null });
                      }}
                    >
                      <X size={11} />
                    </button>
                  </div>
                )}
                <div className="axis-gizmo" aria-hidden="true">
                  <i />
                  <span>X</span>
                  <span>Y</span>
                  <span>Z</span>
                </div>
              </>
            ) : (
              <div className="empty-canvas">
                <div className="empty-object">
                  <span />
                  <span />
                  <span />
                  <Box size={64} strokeWidth={0.75} />
                </div>
                <span className="overline">ROOM TO DO MORE</span>
                <h2>
                  Your scene.
                  <br />
                  <em>A little more possibility.</em>
                </h2>
                <p>
                  Connect a Three.js project. Find the expensive work.
                  <br />
                  Keep the improvements you can prove.
                </p>
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={() => setModal("connect")}
                >
                  Connect a project
                  <ArrowRight size={15} />
                </button>
                <button
                  className="subtle-button"
                  disabled={busy}
                  onClick={() => example("warehouse")}
                >
                  Explore the robotics scene
                  <ArrowUpRight size={13} />
                </button>
              </div>
            )}
            {project?.built && !running && (
              <>
                <div className="canvas-tools">
                  <button
                    aria-label="Reset camera"
                    title="Reset camera"
                    onClick={() => replay(0, 0)}
                  >
                    <RotateCcw size={16} />
                  </button>
                  <button
                    aria-label="Change camera"
                    title="Change camera"
                    onClick={() => replay(time, (camera + 1) % 3)}
                  >
                    <Focus size={16} />
                  </button>
                  <button
                    aria-label="Fullscreen scene"
                    title="Fullscreen scene"
                    onClick={() => viewport.current?.requestFullscreen()}
                  >
                    <Maximize2 size={16} />
                  </button>
                </div>
                <div className="scene-caption">
                  <span className="tiny-dot" />
                  {paused
                    ? "Replay paused"
                    : telemetry
                      ? "Rendered on this machine"
                      : "Production build"}
                  {telemetry && (
                    <span className="scene-live">
                      {telemetry.calls.toLocaleString()} draw calls
                    </span>
                  )}
                </div>
              </>
            )}
          </section>
          <div className="playback">
            <div>
              <button
                className="icon-button"
                aria-label={paused ? "Play scene" : "Pause scene"}
                disabled={running || !project?.built}
                onClick={pause}
              >
                {paused ? <Play size={15} /> : <Pause size={15} />}
              </button>
              <span className="time-label">
                {paused ? fmt(time) + "s" : "LIVE"}
              </span>
              <input
                aria-label="Replay time"
                type="range"
                min="0"
                max="8"
                step=".1"
                value={time}
                disabled={running || !project?.built}
                onChange={(e) => replay(Number(e.target.value))}
              />
            </div>
            <div>
              <button
                className={"playback-button " + (recording ? "recording" : "")}
                disabled={
                  running ||
                  !project?.built ||
                  busy ||
                  !project?.config?.autoInstrument
                }
                onClick={record}
                title={
                  !project?.config?.autoInstrument
                    ? "Interaction recording requires the automatic integration"
                    : "Record actions for replay verification"
                }
              >
                {recording ? <Square size={11} /> : <Radio size={13} />}
                <span>
                  {recording
                    ? `Save ${recorded.length} actions`
                    : "Record actions"}
                </span>
              </button>
              <button
                className={"playback-button " + (compare ? "selected" : "")}
                disabled={running || !project?.built}
                onClick={() => {
                  setCompare(!compare);
                  replay();
                }}
              >
                <Layers3 size={14} />
                <span>Compare</span>
              </button>
            </div>
          </div>
          <div className="scene-summary">
            {recording ? (
              <>
                <span className="record-dot" />
                Recording clicks, drags, and keys in the scene. Stop to save the
                replay.
              </>
            ) : running ? (
              <>
                <span className="pulse-dot" />
                {active?.status === "queued"
                  ? "Job saved in the queue."
                  : "Your job keeps running if the web interface restarts."}
              </>
            ) : baseline ? (
              <>
                <Check size={13} />
                <span>
                  {run?.kind === "optimize" && accepted.length
                    ? `${accepted.length} verified change${accepted.length > 1 ? "s" : ""} in this run.`
                    : "A measured baseline is ready."}
                </span>
                <button onClick={() => setDrawer("measurements")}>
                  Inspect measurements
                  <ArrowUpRight size={12} />
                </button>
              </>
            ) : (
              <>
                <ShieldCheck size={13} />
                Source changes stay in an isolated workspace until you apply
                them.
              </>
            )}
          </div>
        </main>
        <aside className="context-panel">
          <div className="panel-stage">
            <span className="overline">
              {stage === "diagnose"
                ? "01 / DIAGNOSE"
                : stage === "optimize"
                  ? "02 / OPTIMIZE"
                  : "03 / REVIEW"}
            </span>
            <button
              className="icon-button"
              aria-label="Run history"
              title="Run history"
              onClick={() => setDrawer("history")}
            >
              <GitBranch size={15} />
            </button>
          </div>
          {stage === "diagnose" ? (
            <>
              <div className="panel-intro">
                <span className="panel-symbol">
                  <ScanLine size={23} strokeWidth={1.4} />
                </span>
                <h2>
                  Understand
                  <br />
                  the frame.
                </h2>
                <p>
                  {project
                    ? "Start with the project and the work it actually asks the browser to do."
                    : "A local project, a measured baseline, and a useful place to start."}
                </p>
              </div>
              {connectionError && (
                <div className="problem">
                  <TriangleAlert size={15} />
                  <span>{connectionError}</span>
                </div>
              )}
              {run?.status === "failed" && (
                <div className="problem">
                  <TriangleAlert size={15} />
                  <div>
                    <b>The run needs attention</b>
                    <p>{run.error || run.phase}</p>
                    <button onClick={() => setDrawer("logs")}>
                      Open error details
                      <ArrowRight size={12} />
                    </button>
                  </div>
                </div>
              )}
              {project ? (
                <>
                  <div className="project-facts">
                    <Fact
                      label="Framework"
                      value={discovery.framework || "Three.js project"}
                    />
                    <Fact
                      label="Engine"
                      value={discovery.threeVersion || "Detected at runtime"}
                    />
                    <Fact
                      label="Source"
                      value={
                        files.length
                          ? `${files.length} indexed files`
                          : `${project.config?.editableFiles?.length || 0} editable modules`
                      }
                    />
                  </div>
                  {Array.isArray(discovery.issues) &&
                    discovery.issues.length > 0 && (
                      <div className="discovery-notes">
                        {discovery.issues.slice(0, 3).map((issue, i) => (
                          <p key={i}>
                            <TriangleAlert size={12} />
                            {typeof issue === "string"
                              ? issue
                              : issue.message || issue.detail || issue.code}
                          </p>
                        ))}
                      </div>
                    )}
                  {baseline ? (
                    <div className="finding">
                      <div className="finding-heading">
                        <span className="tiny-dot" />
                        <span>MEASURED FINDING</span>
                      </div>
                      <h3>
                        {baseline.calls > 500
                          ? "A lot of small submissions."
                          : "Your baseline, captured."}
                      </h3>
                      <p>
                        {baseline.calls > 500
                          ? `${baseline.calls.toLocaleString()} draw calls in the reference frame. Batching is worth investigating while preserving the scene.`
                          : "Compare candidate changes against this fixed workload and the same rendering conditions."}
                      </p>
                      <div className="reading-list">
                        <Reading
                          label="CPU submission · p95"
                          value={fmt(baseline.submitP95)}
                          unit="ms"
                        />
                        <Reading
                          label="GPU query · p95"
                          value={fmt(baseline.gpuP95, 2)}
                          unit="ms"
                          optional={!Number.isFinite(baseline.gpuP95)}
                        />
                        <Reading
                          label="Frame interval · p95"
                          value={fmt(baseline.frameP95)}
                          unit="ms"
                        />
                      </div>
                      <button
                        className="subtle-button"
                        onClick={() => setDrawer("measurements")}
                      >
                        Measurement conditions
                        <ArrowUpRight size={12} />
                      </button>
                    </div>
                  ) : (
                    <div className="quiet-note">
                      <Cpu size={17} />
                      <p>
                        A profile builds the project and measures it locally. It
                        does not call the model.
                      </p>
                    </div>
                  )}
                  <div className="section-heading">
                    <span>PROJECT SOURCE</span>
                    <button onClick={() => setDrawer("files")}>
                      View all
                      <ArrowUpRight size={11} />
                    </button>
                  </div>
                  <div className="file-list">
                    {(files.length
                      ? files.filter((f) => f.usesThree).slice(0, 4)
                      : project.config?.editableFiles?.map((path) => ({
                          path,
                        })) || []
                    ).map((file) => (
                      <button key={file.path} onClick={() => inspectFile(file)}>
                        <FileCode2 size={14} />
                        <span>{file.path}</span>
                        <ArrowUpRight size={12} />
                      </button>
                    ))}
                  </div>
                  {selectedObject && (
                    <div className="object-card">
                      <div className="section-heading">
                        <span>SELECTED OBJECT</span>
                        <Box size={13} />
                      </div>
                      <b>
                        {selectedObjectInfo?.name ||
                          (typeof selectedObject === "object"
                            ? selectedObject.id
                            : selectedObject)}
                      </b>
                      <p>
                        {selectedObjectInfo?.type ||
                          selectedObjectInfo?.geometryType ||
                          "Scene object"}
                        {selectedObjectInfo?.instances
                          ? ` · ${selectedObjectInfo.instances} instances`
                          : ""}
                      </p>
                      {selectedObjectInfo?.source && (
                        <button
                          className="subtle-button"
                          onClick={() =>
                            inspectFile({ path: selectedObjectInfo.source })
                          }
                        >
                          Related source
                          <ArrowRight size={12} />
                        </button>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="starter-list">
                  <button onClick={() => example("warehouse")} disabled={busy}>
                    <Box size={17} />
                    <span>
                      Warehouse robotics<small>1,600 animated objects</small>
                    </span>
                    <ArrowUpRight size={14} />
                  </button>
                  <button onClick={() => example("assembly")} disabled={busy}>
                    <Layers3 size={17} />
                    <span>
                      Assembly floor<small>Repeated geometry workload</small>
                    </span>
                    <ArrowUpRight size={14} />
                  </button>
                </div>
              )}
            </>
          ) : stage === "optimize" ? (
            <>
              <div className="panel-intro">
                <span
                  className={
                    "panel-symbol " + (isThisRunActive ? "is-working" : "")
                  }
                >
                  <Sparkles size={23} strokeWidth={1.4} />
                </span>
                <h2>
                  A considered
                  <br />
                  change.
                </h2>
                <p>
                  Read the source. Form a hypothesis. Keep only what survives
                  the checks.
                </p>
              </div>
              {!data.provider.configured && (
                <div className="quiet-note">
                  <Settings2 size={17} />
                  <div>
                    <p>Connect a model before starting an optimization.</p>
                    <button
                      className="subtle-button"
                      onClick={() => setModal("settings")}
                    >
                      Set up model access
                      <ArrowRight size={12} />
                    </button>
                  </div>
                </div>
              )}
              {isThisRunActive ? (
                <div className="active-job">
                  <div className="job-state">
                    <Loader2 size={13} className="spin" />
                    <Status value={active.status} />
                  </div>
                  <h3>{active.phase || "Waiting for the worker"}</h3>
                  <div className="job-stages">
                    {[
                      ["Read project", ["reasoning"]],
                      ["Build candidate", ["building"]],
                      [
                        "Verify & measure",
                        ["verifying", "checking", "benchmarking"],
                      ],
                    ].map(([label, statuses], i) => (
                      <div
                        key={label}
                        className={
                          statuses.includes(active.experiments?.at(-1)?.status)
                            ? "current"
                            : ""
                        }
                      >
                        <span>{String(i + 1).padStart(2, "0")}</span>
                        {label}
                      </div>
                    ))}
                  </div>
                  <button
                    className="subtle-button"
                    onClick={() => setDrawer("logs")}
                  >
                    Follow the run
                    <ArrowRight size={12} />
                  </button>
                </div>
              ) : run?.kind === "optimize" ? (
                <div className="run-outcome">
                  <Status value={run.status} />
                  <h3>
                    {accepted.length
                      ? `${accepted.length} change${accepted.length > 1 ? "s" : ""}, verified.`
                      : run.status === "failed"
                        ? "This run needs attention."
                        : "The best workspace stayed intact."}
                  </h3>
                  <p>{run.error || run.phase}</p>
                  {accepted.length > 0 && (
                    <button
                      className="subtle-button"
                      onClick={() => setStage("review")}
                    >
                      Review the accepted patch
                      <ArrowRight size={12} />
                    </button>
                  )}
                </div>
              ) : (
                <div className="quiet-note">
                  <ShieldCheck size={17} />
                  <p>
                    The worker edits a copy. Your original project stays
                    unchanged until you apply a patch.
                  </p>
                </div>
              )}
              <div className="optimization-controls">
                <label>
                  Experiment limit
                  <select
                    aria-label="Experiment limit"
                    value={count}
                    onChange={(e) => setCount(Number(e.target.value))}
                    disabled={running}
                  >
                    {[1, 2, 3, 5].map((n) => (
                      <option key={n} value={n}>
                        {n} experiment{n === 1 ? "" : "s"}
                      </option>
                    ))}
                  </select>
                </label>
                <Fact
                  label="Model"
                  value={data.provider.model || "Not configured"}
                />
                <Fact
                  label="Target"
                  value={
                    run?.metric === "drawCalls"
                      ? "Draw submissions + CPU guard"
                      : "Measured bottleneck"
                  }
                />
              </div>
              <div className="section-heading">
                <span>EXPERIMENTS</span>
                <span>{run?.experiments?.length || 0}</span>
              </div>
              <ExperimentList
                run={run}
                selected={experiment?.id}
                onSelect={(id) => {
                  setExperimentId(id);
                  setDrawer("experiment");
                }}
              />
            </>
          ) : (
            <>
              <div className="panel-intro">
                <span className="panel-symbol">
                  <ShieldCheck size={23} strokeWidth={1.4} />
                </span>
                <h2>
                  Keep what
                  <br />
                  you can prove.
                </h2>
                <p>
                  A source diff, a measured result, and evidence you can
                  inspect.
                </p>
              </div>
              {accepted.length || lastAccepted ? (
                <>
                  <div className="review-reading">
                    <span className="overline">
                      {accepted.length ? "THIS RUN" : "LATEST ACCEPTED CHANGE"}
                    </span>
                    <h3>{(accepted.at(-1) || lastAccepted)?.title}</h3>
                    {baseline && best && (
                      <div className="comparison-readings">
                        <Reading
                          label="CPU submission · p95"
                          before={fmt(baseline.submitP95)}
                          value={fmt(best.submitP95)}
                          unit="ms"
                        />
                        <Reading
                          label="Draw calls"
                          before={baseline.calls?.toLocaleString()}
                          value={best.calls?.toLocaleString()}
                        />
                      </div>
                    )}
                  </div>
                  <div className="section-heading">
                    <span>VERIFICATION</span>
                    <Status
                      value={
                        experiment?.guards?.pass
                          ? "passed"
                          : experiment?.status || "pending"
                      }
                    />
                  </div>
                  {experiment?.guards ? (
                    <div className="check-list">
                      <CheckRow
                        pass={experiment.guards.checks.every(
                          (c) => c.visualPass,
                        )}
                        title="Rendered appearance"
                        text={`${experiment.guards.checks.length} configured viewpoints compared`}
                      />
                      <CheckRow
                        pass={experiment.guards.checks.every(
                          (c) => c.statePass,
                        )}
                        title="Scene state"
                        text="Semantic transforms and object counts checked"
                      />
                      <CheckRow
                        pass={experiment.guards.checks.every(
                          (c) => c.pickingPass !== false,
                        )}
                        title="Interactions"
                        text="Configured picking and replay checks"
                      />
                      <button
                        className="subtle-button"
                        onClick={() => setDrawer("evidence")}
                      >
                        Inspect the evidence
                        <ArrowRight size={13} />
                      </button>
                    </div>
                  ) : (
                    <p className="muted-text">
                      Select a measured experiment to inspect its checks.
                    </p>
                  )}
                  <div className="review-actions">
                    <button onClick={() => setDrawer("experiment")}>
                      <Code2 size={15} /> Review source changes
                      <ArrowUpRight size={13} />
                    </button>
                    <a href={"/api/projects/" + project.id + "/patch"} download>
                      <ArrowDownToLine size={15} /> Export cumulative patch
                      <ArrowUpRight size={13} />
                    </a>
                    {run && (
                      <a href={"/api/runs/" + run.id + "/report"} download>
                        <FileCode2 size={15} /> Download run report
                        <ArrowUpRight size={13} />
                      </a>
                    )}
                  </div>
                  <p className="scope-note">
                    These checks cover the configured workload. They do not
                    prove every possible application state.
                  </p>
                </>
              ) : (
                <div className="review-empty">
                  <GitBranch size={27} strokeWidth={1} />
                  <h3>Nothing to apply yet.</h3>
                  <p>
                    Accepted experiments appear here with their source changes
                    and verification evidence.
                  </p>
                  <button
                    className="subtle-button"
                    onClick={() => setStage("optimize")}
                  >
                    Go to Optimize
                    <ArrowRight size={13} />
                  </button>
                </div>
              )}
            </>
          )}
          <div className="panel-bottom">
            {running ? (
              <button
                className="stop-button"
                onClick={() => act(() => api("/stop", {}))}
              >
                <Square size={12} /> Stop current job
              </button>
            ) : (
              <button
                className="primary-button"
                disabled={
                  busy || (stage === "review" && !project?.lastAcceptedRun)
                }
                onClick={primary.click}
              >
                {busy ? (
                  <Loader2 size={15} className="spin" />
                ) : (
                  <primary.icon size={15} />
                )}{" "}
                {primary.label}
                <ArrowRight size={15} />
              </button>
            )}
            {stage === "diagnose" && baseline && !running && (
              <button
                className="stage-next"
                onClick={() => setStage("optimize")}
              >
                Continue to Optimize
                <ArrowRight size={12} />
              </button>
            )}
            <span>
              <ShieldCheck size={11} />
              {stage === "review"
                ? "Conflict checks and backups before Apply."
                : "Measured changes. Your original stays yours."}
            </span>
          </div>
        </aside>
      </div>
      <footer
        className="studio-footer"
        inert={modal || drawer ? true : undefined}
      >
        <span>Less work per frame.</span>
        <div>
          <button onClick={() => setDrawer("measurements")}>
            <Cpu size={11} /> Measurements
          </button>
          <button onClick={() => setDrawer("logs")}>
            <Terminal size={11} /> Run details
          </button>
          <button onClick={() => setModal("help")}>
            Adapter & help
            <ArrowUpRight size={10} />
          </button>
        </div>
        <span>
          {project?.config?.autoInstrument
            ? "Automatic integration"
            : "Local workspace"}
          <i />
          v0.2
        </span>
      </footer>
      {notice && (
        <div className="toast" role="status">
          <TriangleAlert size={15} />
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
            aria-label={modal}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="dialog-close icon-button"
              autoFocus
              aria-label="Close dialog"
              onClick={() => setModal(null)}
            >
              <X size={19} />
            </button>
            {modal === "connect" ? (
              <Connect
                busy={busy}
                onExample={example}
                onConnect={(body) =>
                  act(async () => {
                    const p = await api("/projects", body);
                    chooseProject(p.id);
                    setModal(null);
                    setNotice(
                      "Project connected. Profile it to build and measure the scene.",
                    );
                  })
                }
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
                <span className="dialog-symbol">
                  <GitBranch size={24} />
                </span>
                <span className="overline">APPLY ACCEPTED CHANGES</span>
                <h2>Ready for your project.</h2>
                <p>
                  FrameShift will check for conflicting edits and save a backup
                  before writing the accepted source changes.
                </p>
                <code className="project-path">{project?.original}</code>
                <div className="dialog-actions">
                  <button
                    className="small-button"
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
                    Apply patch
                    <Check size={14} />
                  </button>
                </div>
              </>
            ) : modal === "capture" ? (
              <>
                <span className="dialog-symbol">
                  <Layers3 size={24} />
                </span>
                <span className="overline">WEBGL DIAGNOSTIC CAPTURE</span>
                <h2>Inside one frame.</h2>
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
            aria-label="Run inspector"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <div>
                <span className="overline">WORKSPACE INSPECTOR</span>
                <h2>
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
              </div>
              <button
                className="icon-button"
                autoFocus
                aria-label="Close inspector"
                onClick={() => setDrawer(null)}
              >
                <X size={19} />
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
                      text="Profile a project to collect a run record."
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
                      className="small-button"
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
                          setDrawer(null);
                        }}
                      >
                        <div>
                          <span>
                            {r.kind === "optimize"
                              ? "Optimization"
                              : r.kind === "profile"
                                ? "Profile"
                                : "Verifier test"}
                          </span>
                          <Status value={r.status} />
                        </div>
                        <small>{new Date(r.createdAt).toLocaleString()}</small>
                        <p>{r.phase}</p>
                      </button>
                    ))
                  ) : (
                    <Empty
                      title="Your history starts with a profile."
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
                      <span className="overline">HYPOTHESIS</span>
                      <p className="drawer-description">
                        {experiment.hypothesis || "Waiting for a proposal."}
                      </p>
                      <span className="overline">OUTCOME</span>
                      <p className="drawer-description">
                        {experiment.reason ||
                          "The worker is evaluating this candidate."}
                      </p>
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
                      text="Run an optimization to inspect its proposed source changes."
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
function Status({ value }) {
  return (
    <span className={"status " + value}>
      <i />
      {value?.replaceAll("-", " ") || "pending"}
    </span>
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
function Empty({ title, text }) {
  return (
    <div className="empty-detail">
      <Layers3 size={26} strokeWidth={1} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function ExperimentList({ run, selected, onSelect }) {
  return (
    <div className="experiment-list">
      {run?.experiments?.length ? (
        run.experiments.map((e, i) => (
          <button
            key={e.id}
            className={selected === e.id ? "selected" : ""}
            onClick={() => onSelect(e.id)}
          >
            <span className="attempt-number">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div>
              <b>{e.title || "Inspecting the project…"}</b>
              <Status value={e.status} />
            </div>
            <ChevronRight size={12} />
          </button>
        ))
      ) : (
        <p className="muted-text">
          One hypothesis per experiment. Every outcome stays in the record.
        </p>
      )}
    </div>
  );
}
function ExperimentSelector({ run, value, onSelect }) {
  return (
    <label className="experiment-selector">
      Experiment
      <select value={value || ""} onChange={(e) => onSelect(e.target.value)}>
        {!run?.experiments?.length && <option>No experiments</option>}
        {run?.experiments?.map((e, i) => (
          <option key={e.id} value={e.id}>
            {i + 1}. {e.title || "Pending proposal"}
          </option>
        ))}
      </select>
    </label>
  );
}
function Diff({ text }) {
  return (
    <pre className="diff">
      {text.split("\n").map((line, i) => (
        <span
          key={i}
          className={
            line.startsWith("+")
              ? "added"
              : line.startsWith("-")
                ? "removed"
                : line.startsWith("@@")
                  ? "hunk"
                  : ""
          }
        >
          {line || " "}
          <br />
        </span>
      ))}
    </pre>
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
          className="small-button"
          href={"/api/runs/" + run.id + "/report"}
          download
        >
          <ArrowDownToLine size={14} /> Download evidence report
        </a>
      )}
    </>
  );
}
function Evidence({ run, experiment, onSelect }) {
  return (
    <>
      <ExperimentSelector
        run={run}
        value={experiment?.id}
        onSelect={onSelect}
      />
      {experiment?.guards ? (
        <>
          <div className="guard-result">
            <Status value={experiment.guards.pass ? "passed" : "rejected"} />
            <p>
              {experiment.guards.pass
                ? "The configured checks passed."
                : "The candidate failed one or more checks."}
            </p>
          </div>
          {experiment.guards.checks.map((check, i) => (
            <section className="evidence-case" key={i}>
              <header>
                <h3>{check.label || `View ${i + 1}`}</h3>
                <span>
                  {Number.isFinite(check.time) ? check.time + "s" : ""}
                </span>
              </header>
              <div className="evidence-facts">
                <span>
                  {fmt(check.visualDifference * 100, 4)}% visual difference
                </span>
                <span>{check.objectCount?.toLocaleString()} objects</span>
                <span>
                  {check.statePass ? "Transforms match" : "Transform mismatch"}
                </span>
                <span>
                  {check.pickingPass !== false
                    ? "Picking matches"
                    : "Picking mismatch"}
                </span>
              </div>
              <div className="evidence-images">
                {["reference", "candidate", "diff"].map((type) => (
                  <figure key={type}>
                    <img
                      alt={`${type} ${check.label || "view " + (i + 1)}`}
                      src={`/api/runs/${run.id}/artifacts/${experiment.id}/${type}-${i}.png`}
                    />
                    <figcaption>
                      {type === "reference"
                        ? "Reference"
                        : type === "candidate"
                          ? "Candidate"
                          : "Difference"}
                    </figcaption>
                  </figure>
                ))}
              </div>
              {check.firstTransformMismatch && (
                <details>
                  <summary>Transform mismatch details</summary>
                  <pre className="code-block">
                    {JSON.stringify(check.firstTransformMismatch, null, 2)}
                  </pre>
                </details>
              )}
            </section>
          ))}
          {experiment.guards.replay && (
            <div className="replay-result">
              <h3>Interaction replay</h3>
              <pre className="code-block">
                {JSON.stringify(experiment.guards.replay, null, 2)}
              </pre>
            </div>
          )}
          <p className="scope-note">
            Verification covers these configured states and interactions. It
            cannot prove every possible behavior of the application.
          </p>
        </>
      ) : (
        <Empty
          title="No verification artifacts for this attempt."
          text="Select an experiment that reached the verification stage."
        />
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
      <h2>Bring your own scene.</h2>
      <p>
        Point FrameShift at a local project. It will inspect the framework,
        entry points, dependencies, and build setup before connecting.
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
