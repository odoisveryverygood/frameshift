import React, { Suspense, lazy, useEffect, useState } from "react";
import { NAMES } from "./agentNames.js";
import { deriveLiveActivity, STATUS_LABELS } from "./live-activity.mjs";
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
    name: NAMES.investigator.codename,
    subtitle: "Investigator",
    role: NAMES.investigator.description,
    color: "#2f6bff",
    waiting: "Will read your scene and source and find the slowdown.",
  },
  {
    id: "gauge",
    ...NAMES.optimizer,
    name: NAMES.optimizer.codename,
    subtitle: "Optimizer",
    role: NAMES.optimizer.description,
    color: "#7a52ff",
    waiting: "Will write one focused fix in an isolated copy.",
  },
  {
    id: "smith",
    ...NAMES.risk,
    name: NAMES.risk.codename,
    subtitle: "SubQ risk assessment",
    role: NAMES.risk.description,
    color: "#e0602c",
    waiting: "Will predict what the fix could break.",
  },
  {
    id: "warden",
    ...NAMES.verifier,
    name: NAMES.verifier.codename,
    subtitle: "Deterministic verifier",
    role: NAMES.verifier.description,
    color: "#0fa58c",
    waiting: "Will run the checks and measurements and decide.",
  },
];
export default function AgentField({
  job,
  project,
  baselineSrc,
  preview,
  revealed = true,
  measuring = false,
  preparingOptimization = false,
}) {
  const [focus, setFocus] = useState(null);
  useEffect(() => {
    if (!focus) return;
    const key = (e) => e.key === "Escape" && setFocus(null);
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [focus]);
  const activity = deriveLiveActivity(job, { preview, preparingOptimization });
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
  const risks = Object.keys(exp?.riskAssessment?.probabilities || {});
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
          ? risks.length ? risks.map((r) => `${r} risk`) : ["Risk assessment pending"]
          : exp?.guards?.checks?.length
            ? exp.guards.checks.slice(0, 6).map((check, i) => `Checkpoint ${i + 1}${Number.isFinite(check.time) ? ` · ${check.time}s` : ""}`)
            : ["Baseline", "Visual checks", "State checks", "Benchmarks"];
  const info = AGENTS.map((a) => {
    const stage = activity.stages.find((s) => s.id === a.id);
    return { ...a, ...stage, statusLabel: STATUS_LABELS[stage.state], parts: partsFor(a.id) };
  });
  const current = info.find((a) => a.state === "working");
  const focused = info.find((a) => a.id === focus);
  const log = (focused ? activity.activity.filter((e) => e.stage === focused.id) : activity.activity).slice(-10).reverse();
  return (
    <div className="factory">
      <Suspense fallback={<div className="solar-scene" />}>
        <SolarScene
          agents={info}
          paused={measuring}
          revealed={revealed}
          projectName={project?.name || "Your project"}
          focus={focus}
          onFocus={setFocus}
        />
      </Suspense>
      <aside className="activity-panel" aria-label="What the agents are doing">
        <div className="activity-progress">
          <span>{preview ? "Illustrated sample" : "Stages completed"}</span>
          <b>{preview ? "Sample" : `${activity.completedCount} / ${AGENTS.length}`}</b>
          <small>{activity.summary}</small>
        </div>
        {focused && (
          <section className="activity-inside" style={{ "--c": focused.color }}>
            <span className="eyebrow">Inside {focused.name}</span>
            <p>
              {focused.statusLabel}: {focused.task}
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
            {activity.detail && <small>{activity.detail}</small>}
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
              <em>{a.statusLabel}</em>
            </li>
          ))}
        </ol>
        <section className="activity-log">
          <span className="eyebrow">{focused ? `${focused.name} · recorded activity` : "Recorded tools & events"}</span>
          <ol>
            {log.map((event, i) => {
              const who = info.find((a) => a.id === event.stage);
              return (
                <li key={i} className={event.rejected ? "tool-rejected" : ""} style={{ "--c": who?.color }}>
                  {who && <b>{who.name} · </b>}{event.text}
                </li>
              );
            })}
            {!log.length && <li>{preview ? "Sample only. No tools have run." : "No activity recorded for this stage yet."}</li>}
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
            ? "Sample animation: no AI, builds, or measurements are running."
            : "Argus investigates · Vulcan patches · Oracle assesses risk with SubQ · Aegis runs deterministic checks. The moving workers illustrate these stages; they are not extra AI agents."}
        </p>
      </aside>
    </div>
  );
}
