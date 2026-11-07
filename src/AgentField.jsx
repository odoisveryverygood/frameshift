import React, { Suspense, lazy, useEffect, useState } from "react";
import { NAMES } from "./agentNames.js";
import "./agents.css";

// three.js only loads for this screen.
const SolarScene = lazy(() => import("./SolarScene.jsx"));

// The four kinds of work in a Sift run, each shown as an agent. Every agent's state,
// task and log come from the run itself: which events it has logged and what the run
// is doing now. They are the stages of one run, not separate AI models.
// The planets keep their internal ids (orbit and colour); each one is a real role
// in the backend pipeline, in order: find → patch → assess risk → prove.
const AGENTS = [
  {
    id: "scout",
    ...NAMES.investigator,
    role: NAMES.investigator.description,
    color: "#2f6bff",
    types: ["build", "recovery", "investigator"],
    waiting: "Will read your scene and source and find the slowdown.",
  },
  {
    id: "gauge",
    ...NAMES.optimizer,
    role: NAMES.optimizer.description,
    color: "#7a52ff",
    types: ["optimizer", "agent", "repair", "inconclusive"],
    waiting: "Will write one focused fix in an isolated copy.",
  },
  {
    id: "smith",
    ...NAMES.risk,
    role: NAMES.risk.description,
    color: "#e0602c",
    types: ["verifier"],
    waiting: "Will predict what the fix could break.",
  },
  {
    id: "warden",
    ...NAMES.verifier,
    role: NAMES.verifier.description,
    color: "#0fa58c",
    types: [
      "profile",
      "benchmark",
      "verify",
      "challenge",
      "complete",
      "accepted",
      "rejected",
    ],
    waiting: "Will run the checks and measurements and decide.",
  },
];
const owner = (type) => AGENTS.find((a) => a.types.includes(type))?.id;

// Which agent is busy right now, from the run's own state.
function activeAgent(job) {
  if (job.status === "queued") return null;
  const exp = job.experiments?.at(-1)?.status;
  const last = (job.events || []).at(-1)?.type;
  // The risk step logs a "verifier" event before the checks start.
  if (last === "verifier" && exp !== "verifying") return "smith";
  if (["verifying", "checking", "benchmarking"].includes(exp)) return "warden";
  if (exp === "building") return "gauge";
  if (exp === "reasoning") return last === "investigator" ? "scout" : "gauge";
  if (!job.baseline) return last === "profile" ? "warden" : "scout";
  return owner(last) || "gauge";
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
  const cited = (exp?.investigation?.evidence || [])
    .map((e) => e.path)
    .filter((p, i, all) => p && all.indexOf(p) === i);
  const risks = exp?.riskAssessment?.probabilities
    ? Object.keys(exp.riskAssessment.probabilities)
    : ["identity", "animation", "geometry", "timing"];
  const partsFor = (id) =>
    id === "scout"
      ? (cited.length ? cited : files)
          .slice(0, 6)
          .concat(
            cited.length || files.length ? [] : ["Source", "Scene", "Profile"],
          )
      : id === "gauge"
        ? patched.length
          ? patched.slice(0, 6)
          : files.length
            ? files.slice(0, 4)
            : ["Patch", "Build", "Repair"]
        : id === "smith"
          ? risks.map((r) => `${r} risk`)
          : ["Draw calls", "CPU submit", "Frame time", "Picking", "Transforms"];
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
  const probs = exp?.riskAssessment?.probabilities;
  const detail =
    current?.id === "scout" && exp?.investigation?.hypothesis
      ? exp.investigation.hypothesis
      : current?.id === "gauge" && exp?.title
        ? exp.title
        : current?.id === "smith" && probs
          ? Object.entries(probs)
              .map(([k, v]) => `${k} ${Number(v).toFixed(2)}`)
              .join(" · ")
          : current?.id === "warden" && exp?.guards?.checks?.length
            ? `${exp.guards.checks.filter((c) => c.visualPass && c.statePass && c.pickingPass !== false).length} of ${exp.guards.checks.length} checkpoints pass`
            : current?.id === "warden" && Number.isFinite(job.baseline?.calls)
              ? `${job.baseline.calls.toLocaleString()} draw calls · CPU ${job.baseline.submitP95?.toFixed(1)} ms`
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
                <b>
                  {a.name} <span className="agent-sub">{a.subtitle}</span>
                </b>
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
