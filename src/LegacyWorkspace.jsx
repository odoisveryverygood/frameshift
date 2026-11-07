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
import StlImport from "./StlImport.jsx";
const RobotRepair=React.lazy(()=>import('./RobotRepair.jsx'));
import {
  SelectionPin,
  InvestigationRibbon,
  ExperimentTimeline,
  SpatialEvidence,
  ChallengeMarkers,
} from "./SpatialWorkspace.jsx";
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
        return (
          new URLSearchParams(location.search).get("project") ||
          localStorage.getItem("frameshift:project") ||
          ""
        );
      } catch {
        return "";
      }
    }),
    [stage, setStage] = useState("diagnose"),
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
    [sceneContext, setSceneContext] = useState(null),
    [findings, setFindings] = useState([]),
    [challenges, setChallenges] = useState([]),
    [investigating, setInvestigating] = useState(false),
    [intent, setIntent] = useState("investigate"),
    [detailsOpen, setDetailsOpen] = useState(false),
    [sceneVersion, setSceneVersion] = useState("current"),
    [challengeRecording, setChallengeRecording] = useState(false),
    [sceneLoading, setSceneLoading] = useState(true),
    [sceneLoadError, setSceneLoadError] = useState("");
  const preview = useRef(null),
    reference = useRef(null),
    viewport = useRef(null),
    recordingRef = useRef(false),
    recordedRef = useRef([]),
    recordStart = useRef(0),
    lastStageRun = useRef(null),
    sceneContextRef = useRef(null),
    challengeContextRef = useRef(null),
    challengeRecordingRef = useRef(false),
    pendingSceneSyncRef = useRef(null),
    awaitingSceneContextRef = useRef(false);
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
  const displayJob = projectJob || active;
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
  // The Review summary is pinned to one accepted candidate. Historical drawer
  // selection stays independent so inspecting a later rejection cannot change it.
  const reviewRun = accepted.length ? run : latestAcceptedRun;
  const reviewExperiment = accepted.at(-1) || lastAccepted;
  const reviewBaseline = reviewExperiment?.reference || reviewRun?.baseline;
  const reviewBest = reviewExperiment?.candidate || reviewRun?.best;
  function openReviewDrawer(kind) {
    if (!reviewRun || !reviewExperiment) return;
    setRunId(reviewRun.id);
    setExperimentId(reviewExperiment.id);
    setDrawer(kind);
  }
  const baseline = run?.baseline,
    best = run?.best || baseline;
  const discovery = project?.discovery || {};
  const files = Array.isArray(discovery.files) ? discovery.files : [];
  const isThisRunActive = Boolean(
    active && project && active.projectId === project.id,
  );
  const candidateExperiment = projectRuns
    .flatMap((r) => (r.experiments || []).map((e) => ({ ...e, runId: r.id })))
    .find((e) => e.previewUrl);
  const candidateUrl = candidateExperiment?.previewUrl;
  const liveExperiment = projectJob?.experiments?.at(-1);
  const measurementBusy = Boolean(
    running &&
    (!isThisRunActive ||
      projectJob?.kind !== "optimize" ||
      !candidateUrl ||
      ["benchmarking"].includes(liveExperiment?.status) ||
      !liveExperiment),
  );
  const sceneSuspended =
    running && (measurementBusy || sceneVersion !== "candidate");
  const sceneUrl =
    sceneVersion === "original"
      ? `/baseline/${project?.id}/index.html`
      : sceneVersion === "candidate" && candidateUrl
        ? candidateUrl
        : `/preview/${project?.id}/index.html`;
  useEffect(() => {
    if (sceneSuspended || !project?.built) return;
    const captured = sceneContextRef.current;
    pendingSceneSyncRef.current = {
      cameraState: captured?.cameraState || captured?.camera || null,
      time: Number.isFinite(captured?.time) ? captured.time : 0,
      selectedId: captured?.selectedId || null,
    };
    awaitingSceneContextRef.current = true;
    setTelemetry(null);
    setSceneLoading(true);
    setSceneLoadError("");
    let attempts = 0;
    const poll = setInterval(() => {
      if (!awaitingSceneContextRef.current) return clearInterval(poll);
      // Retry one uncommitted iframe navigation before offering manual recovery.
      if (++attempts === 6 && preview.current) preview.current.src = sceneUrl;
      if (attempts > 20) {
        clearInterval(poll);
        setSceneLoading(false);
        setSceneLoadError(
          "The scene has not confirmed it is ready. Reload the preview to reconnect.",
        );
        return;
      }
      preview.current?.contentWindow?.postMessage(
        { type: "frameshift:context" },
        "*",
      );
    }, 500);
    return () => clearInterval(poll);
  }, [
    sceneUrl,
    project?.built,
    project?.lastAcceptedExperiment,
    sceneSuspended,
    sceneVersion === "candidate" ? candidateExperiment?.id : null,
  ]);
  const activeFinding = sceneContext?.selectedId
    ? findings.find(
        (f) =>
          f.selectedId === sceneContext.selectedId ||
          f.context?.selectedId === sceneContext.selectedId ||
          f.selection?.id === sceneContext.selectedId,
      )
    : findings[0];
  useEffect(() => {
    if (!project?.id) return;
    let alive = true;
    const load = async () => {
      const [f, c] = await Promise.allSettled([
        api(`/projects/${project.id}/findings`),
        api(`/projects/${project.id}/challenges`),
      ]);
      if (!alive) return;
      if (f.status === "fulfilled")
        setFindings(
          [...(f.value.findings || [])].sort((a, b) =>
            String(b.createdAt).localeCompare(String(a.createdAt)),
          ),
        );
      if (c.status === "fulfilled") setChallenges(c.value.challenges || []);
    };
    load();
    const timer = setInterval(load, 3500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [project?.id]);
  const scenarioCount =
    project?.config?.scenario?.events?.length ||
    project?.scenario?.events?.length ||
    recorded.length;
  useEffect(() => {
    if (!project) return;
    try {
      localStorage.setItem("frameshift:project", project.id);
    } catch {}
    try {
      setMission(localStorage.getItem("earl:mission:" + project.id) || "");
    } catch {}
    setTelemetry(null);
    setObjects([]);
    setSelectedObject(null);
    setSceneContext(null);
    sceneContextRef.current = null;
    setFindings([]);
    setChallenges([]);
    setSceneVersion("current");
    challengeRecordingRef.current = false;
    setChallengeRecording(false);
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
        e.source === preview.current?.contentWindow &&
        ["frameshift:context", "frameshift:telemetry"].includes(value.type) &&
        pendingSceneSyncRef.current
      ) {
        const desired = pendingSceneSyncRef.current;
        // Clear before posting: the sync response must not restart the handshake.
        pendingSceneSyncRef.current = null;
        if (desired.cameraState) {
          preview.current.contentWindow.postMessage(
            {
              type: "frameshift:sync",
              cameraState: desired.cameraState,
              time: desired.time,
            },
            "*",
          );
          if (desired.selectedId)
            preview.current.contentWindow.postMessage(
              { type: "frameshift:select", id: desired.selectedId },
              "*",
            );
          preview.current.contentWindow.postMessage(
            { type: "frameshift:context" },
            "*",
          );
          return;
        }
      }

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
      if (
        value.type === "frameshift:context" &&
        e.source === preview.current?.contentWindow
      ) {
        const context = value.context;
        if (
          context?.version === 1 &&
          (!context.selectedId || typeof context.selectedId === "string")
        ) {
          awaitingSceneContextRef.current = false;
          setSceneLoading(false);
          setSceneLoadError("");
          setSceneContext(context);
          sceneContextRef.current = context;
          setSelectedObject(context.selected || context.selectedId || null);
          if (context.cameraState && Number.isFinite(context.time))
            reference.current?.contentWindow?.postMessage(
              {
                type: "frameshift:sync",
                cameraState: context.cameraState,
                time: context.time,
              },
              "*",
            );
        }
      }
      if (value.type === "frameshift:error")
        setNotice(String(value.message || "Scene replay failed").slice(0, 300));
      if (
        value.type === "frameshift:selection" &&
        e.source === preview.current?.contentWindow
      ) {
        setSelectedObject(value.object || value.id || null);
        preview.current?.contentWindow?.postMessage(
          { type: "frameshift:context" },
          "*",
        );
      }
      if (
        value.type === "frameshift:interaction" &&
        recordingRef.current &&
        e.source === preview.current?.contentWindow
      ) {
        const event = value.event || value.interaction;
        if (event && recordedRef.current.length < 80) {
          // The recorder ribbon can resize the canvas. Bind the contract to the
          // camera actually used for the demonstrated click, keeping its target.
          if (
            challengeRecordingRef.current &&
            event.type === "click" &&
            sceneContextRef.current?.camera
          ) {
            challengeContextRef.current = {
              ...challengeContextRef.current,
              camera: sceneContextRef.current.camera,
              cameraState: sceneContextRef.current.camera,
              time: sceneContextRef.current.time,
            };
          }
          const at = challengeRecordingRef.current
            ? 0
            : Number.isFinite(event.at)
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
    setStage("diagnose");
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
  function updateMission(value) {
    setMission(value);
    if (project) {
      try {
        localStorage.setItem("earl:mission:" + project.id, value);
      } catch {}
    }
  }
  async function launch(kind) {
    if (!project) return setModal("connect");
    if (kind === "optimize" && !data.provider.configured)
      return setModal("settings");
    await act(async () => {
      setCompare(false);
      setExperimentId(null);
      const r = await api("/projects/" + project.id + "/runs", {
        kind,
        count,
        mission: mission.trim(),
        sceneContext: sceneContextRef.current || undefined,
        findingId: activeFinding?.stale ? undefined : activeFinding?.id,
      });
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
          label: !project
            ? "Open a local project"
            : baseline
              ? "Profile again"
              : "Profile scene",
          icon: ScanLine,
          click: () => launch("profile"),
        }
      : stage === "optimize"
        ? {
            label: "Improve performance",
            icon: Sparkles,
            click: () => launch("optimize"),
          }
        : {
            label: "Apply accepted patch",
            icon: CheckCheck,
            click: () => setModal("apply"),
          };
  async function investigateSelection() {
    if (!project) return setModal("connect");
    const context = sceneContextRef.current;
    if (!context) {
      send({ type: "frameshift:context" });
      return setNotice(
        "Let the scene load, then click an object to investigate.",
      );
    }
    setInvestigating(true);
    setBusy(true);
    try {
      const result = await api(`/projects/${project.id}/findings`, {
        goal:
          mission.trim() ||
          "Explain the selected object's rendering cost and identify a source-backed optimization experiment.",
        context,
      });
      const finding = result.finding || result;
      setFindings((old) => [
        finding,
        ...old.filter((f) => f.id !== finding.id),
      ]);
      setNotice(
        "Investigation ready. Open the pinned finding to inspect its evidence.",
      );
    } catch (error) {
      setNotice(error.message);
    } finally {
      setInvestigating(false);
      setBusy(false);
    }
  }
  async function toggleChallenge() {
    if (!project || running || busy) return;
    if (challengeRecording) {
      recordingRef.current = false;
      challengeRecordingRef.current = false;
      setRecording(false);
      setChallengeRecording(false);
      send({ type: "frameshift:record-stop" });
      if (!recordedRef.current.length)
        return setNotice(
          "No interaction was recorded. Record again and click the object to test.",
        );
      await act(async () => {
        const result = await api(`/projects/${project.id}/challenges`, {
          context: challengeContextRef.current,
          scenario: { events: recordedRef.current },
          expectedSelection: challengeContextRef.current?.selectedId,
        });
        if (result.challenge)
          setChallenges((old) => [result.challenge, ...old]);
        setNotice(
          "Challenge queued. Earl will replay the actual interaction against both versions.",
        );
      });
      return;
    }
    if (!sceneContextRef.current?.selectedId)
      return setNotice(
        "Click the object you want to protect, then record its selection challenge.",
      );
    challengeContextRef.current = structuredClone(sceneContextRef.current);
    challengeContextRef.current.camera =
      challengeContextRef.current.camera ||
      challengeContextRef.current.cameraState;
    challengeRecordingRef.current = true;
    recordedRef.current = [];
    setRecorded([]);
    recordStart.current = performance.now();
    recordingRef.current = true;
    setRecording(true);
    setChallengeRecording(true);
    setPaused(true);
    send({
      type: "frameshift:sync",
      cameraState: sceneContextRef.current.cameraState,
      time: sceneContextRef.current.time,
    });
    send({ type: "frameshift:record-start" });
  }
  function restoreSceneContext() {
    // onLoad is not scene readiness. Request a handshake and restore only after
    // the child confirms that its actual renderer/context exists.
    const context = sceneContextRef.current;
    if (!pendingSceneSyncRef.current)
      pendingSceneSyncRef.current = {
        cameraState: context?.cameraState || context?.camera || null,
        time: Number.isFinite(context?.time) ? context.time : 0,
        selectedId: context?.selectedId || null,
      };
    awaitingSceneContextRef.current = true;
    setSceneLoading(true);
    setTelemetry(null);
    preview.current?.contentWindow?.postMessage(
      { type: "frameshift:objects" },
      "*",
    );
    preview.current?.contentWindow?.postMessage(
      { type: "frameshift:context" },
      "*",
    );
  }
  const selectedObjectInfo =
    typeof selectedObject === "object"
      ? selectedObject
      : objects.find((o) => String(o.id) === String(selectedObject));
  return (
    <div
      className={"studio spatial-studio " + (detailsOpen ? "details-open" : "")}
    >
      <header
        className="studio-header"
        inert={modal || drawer ? true : undefined}
      >
        <a
          href="#"
          className="wordmark"
          aria-label="Earl home"
          onClick={(e) => {
            e.preventDefault();
            setStage("diagnose");
          }}
        >
          <span className="wordmark-symbol">
            <span className="earl-mark">
              <i />
              <i />
              <i />
            </span>
          </span>
          earl<span className="wordmark-dot">.</span>
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
                : "Your local performance engineer"}
            </span>
          </div>
          <ChevronDown size={12} />
        </div>
        <nav className="stage-nav" aria-label="Optimization stages">
          {[
            ["diagnose", "01", "Investigate"],
            ["optimize", "02", "Experiment"],
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
          <button
            className="small-button spatial-evidence-toggle"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((v) => !v)}
          >
            <Layers3 size={14} />
            <span>{detailsOpen ? "Close evidence" : "Evidence"}</span>
          </button>
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
          <button
            className="small-button"
            aria-label="Connect project"
            onClick={() => setModal("connect")}
          >
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
                  ? "PERFORMANCE, WITH PROOF"
                  : stage === "optimize"
                    ? "A HYPOTHESIS. A PATCH. A TEST."
                    : "MEASURED. THEN REVIEWED."}
              </span>
              <h1>{project?.name || "Make room for a better frame."}</h1>
              {project?.stlImport && <details className="stl-workspace-report">
                <summary>{project.config?.previewOnly ? 'Sampled model overview · full-file cleanup report' : 'Imported STL · repair report'}</summary>
                <p>{project.stlImport.report?.outputTriangles?.toLocaleString()} retained triangles in the download. {project.config?.previewOnly ? 'The viewport shows a reduced navigation overview. Full-model optimization and verification are disabled; topology and missing parts are not certified.' : 'Review remaining issues before using this mesh.'}</p>
                <p>{project.stlImport.report?.issues?.join(' ')}</p>
                <a href={project.stlImport.originalDownloadUrl} download>Original STL</a>{' · '}<a href={project.stlImport.repairedDownloadUrl} download>Cleaned STL</a>
                {' · '}<a href={'/repair?import='+encodeURIComponent(project.stlImport.id)}>Align a detached part</a>
              </details>}
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
          <form
            className="mission-composer"
            onSubmit={(e) => {
              e.preventDefault();
              intent === "investigate"
                ? investigateSelection()
                : launch("optimize");
            }}
          >
            <div className="mission-heading">
              <span className="mission-avatar">e.</span>
              <label htmlFor="earl-mission">
                {sceneContext?.selectedId
                  ? `Ask about ${sceneContext.selected?.name || sceneContext.selectedId}`
                  : "What should Earl investigate?"}
              </label>
              <span className="mission-local">
                <span className="tiny-dot" />{" "}
                {project ? "Local project" : "On your machine"}
              </span>
            </div>
            <textarea
              id="earl-mission"
              aria-label="Performance goal"
              placeholder={
                sceneContext?.selectedId
                  ? "Why is this expensive? Make it faster while preserving selection."
                  : "Click a part of your scene, or describe what feels slow."
              }
              value={mission}
              maxLength={4000}
              onChange={(e) => updateMission(e.target.value)}
              disabled={running || busy || investigating}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  if (!running && !busy && !investigating)
                    intent === "investigate"
                      ? investigateSelection()
                      : launch("optimize");
                }
              }}
            />
            <div className="mission-actions">
              <div
                className="intent-switch"
                role="group"
                aria-label="Conversation action"
              >
                <button
                  type="button"
                  aria-pressed={intent === "investigate"}
                  onClick={() => setIntent("investigate")}
                >
                  Ask Earl
                </button>
                <button
                  type="button"
                  aria-pressed={intent === "optimize"}
                  disabled={Boolean(project?.config?.previewOnly)}
                  title={project?.config?.previewOnly ? 'A sampled overview cannot be optimized as the complete robot.' : undefined}
                  onClick={() => setIntent("optimize")}
                >
                  Improve
                </button>
              </div>
              <span>
                {running
                  ? isThisRunActive
                    ? "Experiment in progress · your goal is saved with this run"
                    : "Another project is using the local worker"
                  : project
                    ? project.config?.previewOnly ? "Sampled overview · full mesh cleanup is available in the report" : "Inspects source · edits a copy · verifies the result"
                    : "Connect your project or try a real example below"}
              </span>
              <button
                className="mission-submit"
                type="submit"
                disabled={running || busy || investigating || (project?.config?.previewOnly && intent === 'optimize')}
                aria-label={
                  project
                    ? intent === "investigate"
                      ? "Investigate selection"
                      : "Improve performance"
                    : "Connect project to improve performance"
                }
              >
                {busy || investigating ? (
                  <Loader2 className="spin" size={15} />
                ) : (
                  <ArrowUpRight size={18} />
                )}
                <span>
                  {project
                    ? investigating
                      ? "Investigating…"
                      : intent === "investigate"
                        ? "Investigate"
                        : "Improve performance"
                    : "Connect project"}
                </span>
              </button>
            </div>
          </form>
          <section
            className={"viewport " + (compare ? "is-comparing" : "")}
            ref={viewport}
            aria-label="Project scene"
          >
            {sceneSuspended ? (
              <div
                className={
                  "run-cover " +
                  (displayJob?.baseline &&
                  displayJob.projectId === project?.id &&
                  failedBaseline !== displayJob.id
                    ? "has-baseline"
                    : "")
                }
              >
                {displayJob?.baseline &&
                  displayJob.projectId === project?.id &&
                  failedBaseline !== displayJob.id && (
                    <img
                      className="running-baseline"
                      src={
                        "/api/runs/" +
                        displayJob.id +
                        "/baseline/baseline-0.png"
                      }
                      alt="Captured baseline of this project before optimization"
                      onError={() => setFailedBaseline(displayJob.id)}
                    />
                  )}
                <div className="run-status">
                  <div className="run-orbit">
                    <ScanLine size={27} />
                  </div>
                  <span className="overline">
                    {displayJob?.status === "queued"
                      ? "QUEUED FOR THE LOCAL WORKER"
                      : projectJob
                        ? "INDEPENDENT WORKER / " +
                          displayJob?.kind?.toUpperCase()
                        : "LOCAL WORKER BUSY"}
                  </span>
                  <h2>
                    {projectJob
                      ? displayJob?.phase
                      : "Finishing another project"}
                  </h2>
                  <p>
                    {displayJob?.status === "queued"
                      ? "Your first preview is queued and will build when the worker is available."
                      : !projectJob
                        ? "Live previews pause while another project is being measured. Your selected project has not changed."
                        : displayJob?.baseline
                          ? "Baseline capture · live rendering is paused for uncontended measurements."
                          : "The scene is paused while the worker builds, measures, and checks the project."}
                  </p>
                  {candidateUrl && !measurementBusy && (
                    <button
                      className="small-button"
                      onClick={() => {
                        setSceneVersion("candidate");
                        setPaused(true);
                      }}
                    >
                      Explore testing candidate <ArrowUpRight size={13} />
                    </button>
                  )}
                  <button
                    className="subtle-button"
                    onClick={() => setDrawer("logs")}
                  >
                    <Terminal size={13} /> View run details
                    <ArrowRight size={13} />
                  </button>
                </div>
              </div>
            ) : project?.built ? (
              <>
                <iframe
                  sandbox="allow-scripts"
                  ref={preview}
                  key={
                    project.id +
                    ":" +
                    (project.lastAcceptedExperiment || "initial") +
                    ":" +
                    sceneVersion +
                    ":" +
                    (sceneVersion === "candidate"
                      ? candidateExperiment?.id
                      : "")
                  }
                  src={sceneUrl}
                  title="Current project scene"
                  onLoad={restoreSceneContext}
                />
                {compare && (
                  <iframe
                    sandbox="allow-scripts"
                    ref={reference}
                    src={"/baseline/" + project.id + "/index.html"}
                    title="Reference project scene"
                    onLoad={() => {
                      const context = sceneContextRef.current;
                      if (context?.cameraState)
                        reference.current?.contentWindow?.postMessage(
                          {
                            type: "frameshift:sync",
                            cameraState: context.cameraState,
                            time: context.time || 0,
                          },
                          "*",
                        );
                      else replay();
                    }}
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
                {!sceneLoading && (
                  <SelectionPin
                    context={sceneContext}
                    finding={activeFinding}
                    busy={investigating || busy || running}
                    onInvestigate={investigateSelection}
                    onImprove={() => {
                      setIntent("optimize");
                      document.querySelector("#earl-mission")?.focus();
                    }}
                    onChallenge={toggleChallenge}
                    onSource={inspectFile}
                    onClear={() => {
                      setSceneContext((context) =>
                        context
                          ? { ...context, selectedId: null, selected: null }
                          : null,
                      );
                      setSelectedObject(null);
                      send({ type: "frameshift:select", id: null });
                    }}
                  />
                )}
                <ChallengeMarkers
                  challenge={challenges[0]}
                  context={sceneContext}
                  capturedContext={challengeContextRef.current}
                />
                {(sceneLoading || sceneLoadError) && (
                  <div className="scene-readiness" role="status">
                    {sceneLoading ? (
                      <>
                        <Loader2 size={16} className="spin" />
                        <span>Connecting to the scene…</span>
                      </>
                    ) : (
                      <>
                        <TriangleAlert size={16} />
                        <span>{sceneLoadError}</span>
                        <button
                          onClick={() => {
                            const node = preview.current;
                            if (node) node.src = sceneUrl;
                          }}
                        >
                          Reload preview
                        </button>
                      </>
                    )}
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
                <div className="empty-editorial">
                  <span className="overline">
                    {project
                      ? "PROJECT CONNECTED / READY TO INVESTIGATE"
                      : "YOUR CODE. A LITTLE MORE POSSIBILITY."}
                  </span>
                  <h2>
                    {project ? "Your scene." : "Less work."}
                    <br />
                    <em>{project ? "Better frames." : "Better worlds."}</em>
                  </h2>
                  <p>
                    {project ? (
                      "Build a measured baseline, or give Earl a goal. Your running application will appear here."
                    ) : (
                      <>
                        Earl investigates slow 3D applications,
                        <br />
                        experiments on their code, and checks the result.
                      </>
                    )}
                  </p>
                  <div className="empty-actions">
                    <button
                      className="primary-button"
                      disabled={busy || running}
                      onClick={() =>
                        project ? launch("profile") : setModal("connect")
                      }
                    >
                      {project
                        ? "Build & profile scene"
                        : "Open a local project"}{" "}
                      <ArrowRight size={15} />
                    </button>
                    <button
                      className="subtle-button"
                      disabled={busy || running}
                      onClick={() => example("warehouse")}
                    >
                      Try a robotics example <ArrowUpRight size={13} />
                    </button>
                  </div>
                  <span className="compatibility-label">
                    VITE + THREE.JS · RUNS ON YOUR MACHINE
                  </span>
                </div>
                <div className="earl-sculpture" aria-hidden="true">
                  <div className="sculpture-orbit" />
                  <div className="sculpture-column column-one" />
                  <div className="sculpture-column column-two" />
                  <div className="sculpture-column column-three" />
                  <span className="sculpture-caption">
                    LESS OVERHEAD. MORE POSSIBILITY.
                  </span>
                </div>
              </div>
            )}
            {project?.built && !sceneSuspended && (
              <div
                className="scene-version-switch"
                role="group"
                aria-label="Scene version"
              >
                <button
                  aria-pressed={sceneVersion === "original"}
                  onClick={() => {
                    setSceneVersion("original");
                    setCompare(false);
                    setPaused(true);
                  }}
                >
                  Original
                </button>
                <button
                  aria-pressed={sceneVersion === "current"}
                  onClick={() => {
                    setSceneVersion("current");
                    setCompare(false);
                    setPaused(true);
                  }}
                >
                  {project.lastAcceptedExperiment ? "Accepted" : "Current"}
                </button>
                {candidateUrl && (
                  <button
                    aria-pressed={sceneVersion === "candidate"}
                    onClick={() => {
                      setSceneVersion("candidate");
                      setCompare(false);
                      setPaused(true);
                    }}
                  >
                    Candidate{" "}
                    <small>
                      {candidateExperiment.status === "accepted"
                        ? "Verified"
                        : "Testing"}
                    </small>
                  </button>
                )}
              </div>
            )}
            {project?.built && !sceneSuspended && (
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
                  (!project?.config?.autoInstrument &&
                    !sceneContext?.capabilities?.recording) ||
                  challengeRecording
                }
                onClick={record}
                title={
                  !project?.config?.autoInstrument &&
                  !sceneContext?.capabilities?.recording
                    ? "This scene does not expose an interaction recorder"
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
          <InvestigationRibbon
            finding={activeFinding}
            challenges={challenges}
            recording={challengeRecording}
            onStop={toggleChallenge}
            onOpen={() => setDrawer("spatial")}
            onChallenge={() => setDrawer("spatial")}
          />
          <ExperimentTimeline
            runs={projectRuns}
            onSelect={(r, e) => {
              setRunId(r.id);
              setExperimentId(e.id);
              setDetailsOpen(true);
              setStage("review");
              setDrawer("experiment");
            }}
            onDetails={() => setDrawer("history")}
          />
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
                ? "01 / INVESTIGATE"
                : stage === "optimize"
                  ? "02 / EXPERIMENT"
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
                  A clear place
                  <br />
                  to start.
                </h2>
                <p>
                  {project
                    ? "Start with the project and the work it actually asks the browser to do."
                    : "Start with your own code or explore a working example. Earl measures before it changes anything."}
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
                  One experiment.
                  <br />
                  Real evidence.
                </h2>
                <p>
                  Read the source. Form a hypothesis. Keep only what survives
                  the checks.
                </p>
              </div>
              {run?.mission && (
                <div className="run-mission">
                  <span className="overline">THIS RUN’S GOAL</span>
                  <p>{run.mission}</p>
                </div>
              )}
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
                  {active.sponsorMode && (
                    <div className="specialist-tools" aria-live="polite">
                      <span className="overline">ACTUAL AGENT ACTIONS</span>
                      {[
                        ...(active.experiments?.at(-1)?.investigatorTrace ||
                          []),
                        ...(active.experiments?.at(-1)?.trace || []),
                      ]
                        .filter((event) => event.tool)
                        .slice(-4)
                        .map((event, i) => (
                          <p key={i}>
                            <b>{event.role || "Optimizer"}</b> ·{" "}
                            {event.tool.replaceAll("_", " ")}
                            {event.path ? ` · ${event.path}` : ""}
                          </p>
                        ))}
                      {active.experiments?.at(-1)?.riskAssessment && (
                        <p>
                          <b>Verifier</b> ·{" "}
                          {active.experiments
                            .at(-1)
                            .riskAssessment.selectedRisks.join(", ")}{" "}
                          risks selected added checkpoints
                        </p>
                      )}
                      <small>
                        Meta specialists · SubQ risk checks · Fetch local
                        handoffs
                      </small>
                    </div>
                  )}
                  <div className="job-stages">
                    {[
                      [
                        active.sponsorMode
                          ? "Investigator → Optimizer"
                          : "Read project",
                        ["reasoning"],
                      ],
                      ["Build candidate", ["building"]],
                      [
                        active.sponsorMode
                          ? "Verifier · SubQ + tests"
                          : "Verify & measure",
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
                    <h3>{reviewExperiment?.title}</h3>
                    {reviewBaseline && reviewBest && (
                      <div className="comparison-readings">
                        <Reading
                          label="CPU submission · p95"
                          before={fmt(reviewBaseline.submitP95)}
                          value={fmt(reviewBest.submitP95)}
                          unit="ms"
                        />
                        <Reading
                          label="Draw calls"
                          before={reviewBaseline.calls?.toLocaleString()}
                          value={reviewBest.calls?.toLocaleString()}
                        />
                      </div>
                    )}
                  </div>
                  <div className="section-heading">
                    <span>VERIFICATION</span>
                    <Status
                      value={
                        reviewExperiment?.guards?.pass
                          ? "passed"
                          : reviewExperiment?.status || "pending"
                      }
                    />
                  </div>
                  {reviewExperiment?.guards ? (
                    <div className="check-list">
                      <CheckRow
                        pass={reviewExperiment.guards.checks.every(
                          (c) => c.visualPass,
                        )}
                        title="Rendered appearance"
                        text={`${reviewExperiment.guards.checks.length} configured viewpoints compared`}
                      />
                      <CheckRow
                        pass={reviewExperiment.guards.checks.every(
                          (c) => c.statePass,
                        )}
                        title="Scene state"
                        text="Semantic transforms and object counts checked"
                      />
                      <CheckRow
                        pass={reviewExperiment.guards.checks.every(
                          (c) => c.pickingPass !== false,
                        )}
                        title="Interactions"
                        text="Configured picking and replay checks"
                      />
                      <button
                        className="subtle-button"
                        onClick={() => openReviewDrawer("evidence")}
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
                    <button onClick={() => openReviewDrawer("experiment")}>
                      <Code2 size={15} /> Review source changes
                      <ArrowUpRight size={13} />
                    </button>
                    <a href={"/api/projects/" + project.id + "/patch"} download>
                      <ArrowDownToLine size={15} /> Export cumulative patch
                      <ArrowUpRight size={13} />
                    </a>
                    {reviewExperiment?.verifier && reviewRun && (
                      <a
                        href={
                          "/api/runs/" +
                          reviewRun.id +
                          "/experiments/" +
                          reviewExperiment.id +
                          "/verdict"
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ShieldCheck size={15} /> Inspect verifier receipt
                        <ArrowUpRight size={13} />
                      </a>
                    )}
                    {reviewRun && (
                      <a
                        href={"/api/runs/" + reviewRun.id + "/report"}
                        download
                      >
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
                    Go to experiments
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
                disabled={!projectJob}
                onClick={() =>
                  act(() => api("/stop", { runId: projectJob?.id }))
                }
              >
                <Square size={12} />{" "}
                {projectJob
                  ? "Stop this project’s job"
                  : "Worker busy with another project"}
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
                Explore experiments
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
        <span>A little less work. A better frame.</span>
        <div>
          <button onClick={() => setDrawer("measurements")}>
            <Cpu size={11} /> Measurements
          </button>
          <button onClick={() => setDrawer("logs")}>
            <Terminal size={11} /> Run details
          </button>
          <button onClick={() => setModal("help")}>
            Help & compatibility
            <ArrowUpRight size={10} />
          </button>
        </div>
        <span>
          {project?.config?.autoInstrument
            ? "Automatic integration"
            : "Local workspace"}
          <i />
          EARL / LOCAL
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
                onStlConnected={async ({ project: imported, run: firstRun }) => {
                  if(imported.stlImport?.id){location.assign('/repair?import='+encodeURIComponent(imported.stlImport.id));return;}
                  chooseProject(imported.id);
                  if (firstRun?.id) setRunId(firstRun.id);
                  setModal(null);
                  await refresh();
                  setNotice("Robot STL connected. Building its interactive preview.");
                }}
                onConnect={(body) =>
                  act(async () => {
                    const p = await api("/projects", body);
                    if (mission.trim()) {
                      try {
                        localStorage.setItem("earl:mission:" + p.id, mission);
                      } catch {}
                    }
                    chooseProject(p.id);
                    setModal(null);
                    await refresh();
                    try {
                      const firstRun = await api(
                        "/projects/" + p.id + "/runs",
                        { kind: "profile" },
                      );
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
                  })
                }
              />
            ) : modal === "settings" ? (
              <Settings
                provider={data.provider}
                spatialProvider={data.spatialProvider}
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
                  Earl will check for conflicting edits and save a backup before
                  writing the accepted source changes.
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
                      spatial: "Scene investigation",
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
              {drawer === "spatial" ? (
                <SpatialEvidence
                  findings={findings}
                  challenges={challenges}
                  onSource={inspectFile}
                />
              ) : drawer === "measurements" ? (
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
function Connect({ onConnect, onExample, onStlConnected, busy }) {
  const [method, setMethod] = useState("stl");
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
      <span className="overline">OPEN IN EARL</span>
      <h2>{method === "stl" ? "Bring your robot." : "Open your project."}</h2>
      <div className="connect-methods" role="group" aria-label="Project input">
        <button type="button" aria-pressed={method === "stl"} onClick={() => setMethod("stl")} disabled={busy}>Robot STL</button>
        <button type="button" aria-pressed={method === "project"} onClick={() => setMethod("project")} disabled={busy}>Web project</button>
      </div>
      {method === "stl" ? <StlImport busy={busy} onConnected={onStlConnected} /> : <>
      <p>Point Earl at a trusted local Vite + Three.js project. It inspects the source and build setup before connecting.</p>
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
      </>}
    </>
  );
}
function Settings({ provider, spatialProvider, onSave, busy }) {
  const [model, setModel] = useState(provider.model || "gpt-5.4-mini"),
    [baseUrl, setBase] = useState(
      provider.baseUrl || "https://api.openai.com/v1",
    ),
    [apiKey, setKey] = useState(""),
    [protocol, setProtocol] = useState(provider.protocol || "responses");
  if (provider.name === "meta")
    return (
      <div>
        <span className="overline">SPONSOR CONNECTIONS</span>
        <h2>
          Three specialists.
          <br />
          One tested change.
        </h2>
        <p>
          The visual Investigator inspects your selection and source. Meta
          writes focused patches. Subquadratic selects extra verification
          checks. Fetch carries local agent handoffs.
        </p>
        <div className="quiet-note">
          <p>
            Visual Investigator:{" "}
            {spatialProvider?.selected === "gemini"
              ? spatialProvider.gemini?.model || "Gemini"
              : provider.model}
            <br />
            Optimizer: {provider.model}
            <br />
            Meta access:{" "}
            {provider.configured ? "Configured" : "Missing MODEL_API_KEY"}
            <br />
            Public Agentverse discovery is not enabled.
          </p>
        </div>
        <p>
          Credentials stay in the backend’s .env.local file. Update
          MODEL_API_KEY, SUBQ_API_KEY or META_MODEL there and restart Earl. No
          key is sent to this screen.
        </p>
      </div>
    );
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
createRoot(document.getElementById("root")).render(location.pathname==='/repair'?<React.Suspense fallback={<p>Opening repair workspace…</p>}><RobotRepair/></React.Suspense>:<App />);
