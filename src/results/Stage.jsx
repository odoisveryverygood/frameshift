import React, { useEffect, useState } from "react";
import { stageList } from "./Pipeline.jsx";
import PlanetRow from "./PlanetRow.jsx";
import { formatNumber } from "./motion.js";

const ORDER = ["investigator", "optimizer", "risk", "verifier"];
const BARS = [
  ["Draw calls", "calls", 0, ""],
  ["CPU submit p95", "submitP95", 1, " ms"],
  ["Frame p95", "frameP95", 1, " ms"],
  ["Triangles", "triangles", 0, ""],
  ["Geometries", "geometries", 0, ""],
  ["GPU p95", "gpuP95", 2, " ms"],
];
const pass = (c) =>
  c.visualPass &&
  c.statePass &&
  c.pickingPass !== false &&
  c.cameraPass !== false;

// Short labels pinned around the model, all read from the run.
function callouts(id, exp) {
  if (id === "investigator")
    return (exp?.investigation?.evidence || []).slice(0, 3).map((e) => ({
      title: e.path,
      text: e.observation,
    }));
  if (id === "optimizer") {
    const files = [...(exp?.diff || "").matchAll(/^\+\+\+ b\/(.+)$/gm)].map(
      (m) => m[1],
    );
    return [
      exp?.title && { title: "Change", text: exp.title },
      ...files.slice(0, 2).map((f) => ({ title: "Patched", text: f })),
    ].filter(Boolean);
  }
  if (id === "risk") {
    const r = exp?.riskAssessment;
    return Object.entries(r?.probabilities || {})
      .filter(([, p]) => !Number.isFinite(r.threshold) || p >= r.threshold)
      .slice(0, 3)
      .map(([k, p]) => ({
        title: k + " risk",
        text: Number(p).toFixed(2) + " · extra checks added",
        warn: true,
      }));
  }
  const g = exp?.guards;
  if (!g) return [];
  const checks = g.checks || [];
  return [
    checks.length && {
      title: "Checkpoints",
      text: `${checks.filter(pass).length} of ${checks.length} pass`,
      warn: checks.some((c) => !pass(c)),
    },
    g.coverage?.semanticObjects && {
      title: "Objects",
      text: g.coverage.semanticObjects.toLocaleString() + " compared",
    },
    g.coverage?.pickingProbes && {
      title: "Picking",
      text: g.coverage.pickingProbes + " probes",
    },
  ].filter(Boolean);
}

// The dashboard's first screen: the project's own build in the middle, glowing in
// the colour of whichever agent is selected, with that agent's evidence around it.
export default function Stage({ exp, colors, reduced, stageSrc, head }) {
  const stages = stageList(exp, { go: true, reduced });
  const involved = ORDER.filter(
    (id) => stages.find((s) => s.id === id)?.involved,
  );
  // On arrival the run is replayed once in recorded order: when an agent's turn
  // is done a rocket flies to the next planet. Picking an agent stops the replay.
  const [selected, setSelected] = useState(
    reduced ? involved.at(-1) : involved[0],
  );
  const [target, setTarget] = useState(null);
  const [auto, setAuto] = useState(!reduced && involved.length > 1);
  useEffect(() => {
    if (!auto || target) return;
    const i = involved.indexOf(selected);
    if (i >= involved.length - 1) return setAuto(false);
    const timer = setTimeout(() => setTarget(involved[i + 1]), 2600);
    return () => clearTimeout(timer);
  }, [auto, selected, target]);
  const pick = (id) => (setAuto(false), setTarget(id === selected ? null : id));
  const arrive = (id) => (setSelected(id), setTarget(null));
  const stage = stages.find((s) => s.id === selected);
  const color = colors[selected] || "#8a93a3";
  const ref = exp?.reference,
    cand = exp?.candidate;

  return (
    <div className="sg-wrap" style={{ "--c": color }}>
      <PlanetRow
        stages={stages}
        colors={colors}
        selected={selected}
        target={target}
        onArrive={arrive}
        onPick={pick}
        reduced={reduced}
      />
      <div className="sg">
        <aside className="sg-left">{head}</aside>

        <div className={"sg-stage" + (reduced ? " still" : "")}>
          {stageSrc ? (
            <iframe
              key={stageSrc}
              src={stageSrc}
              title="What the project built"
              tabIndex={-1}
            />
          ) : (
            <p className="not-recorded sg-empty">
              No build of this project is available to show.
            </p>
          )}
          <i className="sg-tint" aria-hidden="true" />
          <i className="sg-scan" key={selected} aria-hidden="true" />
          <span className="sg-tag">
            {stageSrc?.includes("/candidate/")
              ? "Candidate build"
              : "Project build"}{" "}
            · live
          </span>
          <ul className="sg-callouts" key={"c" + selected}>
            {callouts(selected, exp).map((c, i) => (
              <li
                key={i}
                className={"co co-" + i + (c.warn ? " warn" : "")}
                style={{ "--i": i }}
              >
                <b>{c.title}</b>
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
        </div>

        <aside className="sg-right">
          <section className="sg-card">
            <header>
              <span className="eyebrow">
                {stage?.involved ? stage.name.subtitle : "Not involved"}
              </span>
              <h3>
                {stage?.name.codename} <small>{stage?.name.name}</small>
              </h3>
              <p className="sg-desc">{stage?.name.description}</p>
            </header>
            {stage?.involved ? (
              stage.body
            ) : (
              <p className="not-recorded">
                This role did not run in this workflow.
              </p>
            )}
          </section>
          <section className="sg-card">
            <header>
              <span className="eyebrow">Reference → candidate</span>
            </header>
            <ul className="sg-bars">
              {BARS.map(([label, key, digits, unit]) => {
                const a = ref?.[key],
                  b = cand?.[key];
                const max = Math.max(a || 0, b || 0) || 1;
                return (
                  <li key={key}>
                    <span>{label}</span>
                    {Number.isFinite(a) && Number.isFinite(b) ? (
                      <>
                        <code>
                          {formatNumber(a, digits)} → {formatNumber(b, digits)}
                          {unit}
                        </code>
                        <i className="track">
                          <i
                            className="was"
                            style={{ width: (a / max) * 100 + "%" }}
                          />
                          <i
                            className="now"
                            style={{ width: (b / max) * 100 + "%" }}
                          />
                        </i>
                      </>
                    ) : (
                      <em>not recorded</em>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
