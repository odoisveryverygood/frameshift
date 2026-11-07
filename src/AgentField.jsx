import React, { Suspense, lazy, useEffect, useState } from "react";
import "./agents.css";

// three.js only loads for this screen.
const SolarScene = lazy(() => import("./SolarScene.jsx"));

// The four kinds of work in a Sift run, each shown as an agent. Every agent's state,
// task and log come from the run itself: which events it has logged and what the run
// is doing now. They are the stages of one run, not separate AI models.
const AGENTS = [
  {
    id: "scout",
    name: "Scout",
    role: "Reads and builds your project",
    color: "#2f6bff",
    types: ["build", "recovery"],
    waiting: "Will read your source and build it.",
  },
  {
    id: "gauge",
    name: "Gauge",
    role: "Measures how it runs",
    color: "#0fa58c",
    types: ["profile", "benchmark", "complete"],
    waiting: "Will measure the scene on this machine.",
  },
  {
    id: "smith",
    name: "Smith",
    role: "Rebuilds it with a patch",
    color: "#7a52ff",
    types: ["agent", "repair", "inconclusive"],
    waiting: "Will propose a fix and rebuild the parts it touches.",
  },
  {
    id: "warden",
    name: "Warden",
    role: "Checks it looks and behaves the same",
    color: "#e0602c",
    types: ["verify", "accepted", "rejected"],
    waiting: "Will compare frames, objects and picking.",
  },
];
const owner = (type) => AGENTS.find((a) => a.types.includes(type))?.id;

// Which agent is busy right now, from the run's own state.
function activeAgent(job) {
  if (job.status === "queued") return null;
  const exp = job.experiments?.at(-1)?.status;
  if (["reasoning", "building"].includes(exp)) return "smith";
  if (["verifying", "checking"].includes(exp)) return "warden";
  if (exp === "benchmarking") return "gauge";
  const last = (job.events || []).at(-1);
  if (!job.baseline) return last?.type === "profile" ? "gauge" : "scout";
  return owner(last?.type) || "smith";
}

const statusText = { working: "Working", done: "Done", waiting: "Waiting" };

export default function AgentField({
  job,
  project,
  baselineSrc,
  preview,
  revealed = true,
}) {
  const [focus, setFocus] = useState(null);
  useEffect(() => {
    if (!focus) return;
    const key = (e) => e.key === "Escape" && setFocus(null);
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [focus]);
  const active = activeAgent(job);
  const events = job.events || [];
  const exp = job.experiments?.at(-1);
  const files = (project?.discovery?.files || [])
    .map((f) => f.path)
    .concat(project?.config?.editableFiles || [])
    .filter((p, i, all) => p && all.indexOf(p) === i);
  const patched = [...(exp?.diff || "").matchAll(/^\+\+\+ b\/(.+)$/gm)].map(
    (m) => m[1],
  );
  // What each agent's workers build in the close-up: real names from this run.
  const partsFor = (id) =>
    id === "scout"
      ? files.length
        ? files.slice(0, 6)
        : ["Source", "Imports", "Bundle"]
      : id === "gauge"
        ? ["Draw calls", "CPU submit", "Frame time", "Triangles", "GPU time"]
        : id === "smith"
          ? patched.length
            ? patched.slice(0, 6)
            : files.length
              ? files.slice(0, 4)
              : ["Patch", "Rebuild", "Repair"]
          : ["View 1", "View 2", "View 3", "Picking", "Transforms"];
  const info = AGENTS.map((a) => {
    const mine = events.filter((e) => a.types.includes(e.type));
    const state =
      a.id === active ? "working" : mine.length ? "done" : "waiting";
    const task =
      state === "working"
        ? job.phase || mine.at(-1)?.message || a.role
        : mine.at(-1)?.message || a.waiting;
    return { ...a, mine, state, task, parts: partsFor(a.id) };
  });
  const current = info.find((a) => a.state === "working");
  const focused = info.find((a) => a.id === focus);
  const doneCount = info.filter((a) => a.state === "done").length;
  const progress = Math.round(
    ((doneCount + (current ? 0.5 : 0)) / AGENTS.length) * 100,
  );
  const detail =
    current?.id === "gauge" && Number.isFinite(job.baseline?.calls)
      ? `${job.baseline.calls.toLocaleString()} draw calls · CPU ${job.baseline.submitP95?.toFixed(1)} ms`
      : current?.id === "smith" && exp?.title
        ? exp.title
        : current?.id === "warden" && exp?.guards?.checks?.length
          ? `${exp.guards.checks.filter((c) => c.visualPass && c.statePass && c.pickingPass !== false).length} of ${exp.guards.checks.length} viewpoints match`
          : null;
  return (
    <div className="factory">
      <Suspense fallback={<div className="solar-scene" />}>
        <SolarScene
          agents={info}
          revealed={revealed}
          projectName={project?.name || "Your project"}
          focus={focus}
          onFocus={setFocus}
        />
      </Suspense>
      <aside className="activity-panel" aria-label="What the agents are doing">
        <div className="activity-progress">
          <span>Rebuild progress</span>
          <b>{progress}%</b>
          <i style={{ width: progress + "%" }} />
        </div>
        {focused && (
          <section className="activity-inside" style={{ "--c": focused.color }}>
            <span className="eyebrow">Inside {focused.name}</span>
            <p>
              {focused.state === "working"
                ? `Working on ${focused.parts.slice(0, 3).join(", ")}`
                : focused.state === "done"
                  ? `Finished: ${focused.task}`
                  : focused.waiting}
            </p>
            <small>
              The small workers show this stage of the run; they are an
              illustration, not separate programs.
            </small>
            <button
              type="button"
              className="link-button"
              onClick={() => setFocus(null)}
            >
              Back to the system
            </button>
          </section>
        )}
        {current && (
          <section
            className="activity-now"
            style={{ "--c": current.color }}
            aria-live="polite"
          >
            <span className="eyebrow">Now · {current.name}</span>
            <p>{current.task}</p>
            {detail && <small>{detail}</small>}
          </section>
        )}
        <ol className="activity-agents">
          {info.map((a) => (
            <li
              key={a.id}
              className={a.state + (focus === a.id ? " focused" : "")}
              style={{ "--c": a.color }}
            >
              <i aria-hidden="true" />
              <button
                type="button"
                onClick={() => setFocus(focus === a.id ? null : a.id)}
                aria-pressed={focus === a.id}
              >
                <b>{a.name}</b>
                <span>{a.role}</span>
                {a.state !== "working" && <small>{a.task}</small>}
              </button>
              <em>{statusText[a.state]}</em>
            </li>
          ))}
        </ol>
        <section className="activity-log">
          <span className="eyebrow">Log</span>
          <ol>
            {events
              .slice(-6)
              .reverse()
              .map((e, i) => {
                const who = AGENTS.find((a) => a.types.includes(e.type));
                return (
                  <li key={events.length - i} style={{ "--c": who?.color }}>
                    {e.message}
                  </li>
                );
              })}
            {!events.length && <li>Waiting for the first step…</li>}
          </ol>
        </section>
        {baselineSrc && (
          <img
            className="activity-frame"
            src={baselineSrc}
            alt="Baseline frame captured for this run"
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
        )}
        <p className="activity-foot">
          {preview
            ? "Preview: nothing is running."
            : "Each agent is one stage of this run."}
        </p>
      </aside>
    </div>
  );
}
