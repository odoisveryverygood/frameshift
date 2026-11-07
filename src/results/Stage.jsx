import React, { useEffect, useState } from "react";
import { stageList } from "./Pipeline.jsx";
import PlanetRow from "./PlanetRow.jsx";
import Model3D from "./Model3D.jsx";
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

// Which part of the model each piece of evidence is about. Evidence text is
// matched on what it mentions; anything unmatched falls back in order.
const RISK_PART = {
  identity: "sensor",
  animation: "arm",
  geometry: "chassis",
  timing: "wheels",
};
function partFor(text, i, fallback) {
  const t = String(text || "").toLowerCase();
  if (/pick|identit|semantic/.test(t)) return "sensor";
  if (/update|animat|position|rotation|transform/.test(t)) return "arm";
  if (/geometr|mesh|draw|material|instanc/.test(t)) return "chassis";
  return fallback[i % fallback.length];
}

// Labels pinned to the model, all read from the run.
function callouts(id, exp) {
  if (id === "investigator")
    return (exp?.investigation?.evidence || []).slice(0, 3).map((e, i) => ({
      title: e.path,
      text: e.observation,
      part: partFor(e.observation, i, ["sensor", "chassis", "arm"]),
    }));
  if (id === "optimizer") {
    const files = [...(exp?.diff || "").matchAll(/^\+\+\+ b\/(.+)$/gm)].map(
      (m) => m[1],
    );
    return [
      exp?.title && { title: "Change", text: exp.title, part: "chassis" },
      ...files.slice(0, 2).map((f, i) => ({
        title: "Patched",
        text: f,
        part: ["lift", "arm"][i],
      })),
    ].filter(Boolean);
  }
  if (id === "risk") {
    const r = exp?.riskAssessment;
    return Object.entries(r?.probabilities || {})
      .filter(([, p]) => !Number.isFinite(r.threshold) || p >= r.threshold)
      .slice(0, 4)
      .map(([k, p]) => ({
        title: k + " risk",
        text: Number(p).toFixed(2) + " · extra checks added",
        warn: true,
        part: RISK_PART[k] || "chassis",
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
      part: "chassis",
    },
    g.coverage?.semanticObjects && {
      title: "Objects",
      text: g.coverage.semanticObjects.toLocaleString() + " compared",
      part: "arm",
    },
    g.coverage?.pickingProbes && {
      title: "Picking",
      text: g.coverage.pickingProbes + " probes",
      part: "sensor",
    },
  ].filter(Boolean);
}

// The dashboard: one screen. The model in the middle lights up the parts the
// selected agent is talking about; agents are planets along the bottom.
export default function Stage({ exp, colors, reduced, head }) {
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
    const timer = setTimeout(() => setTarget(involved[i + 1]), 3600);
    return () => clearTimeout(timer);
  }, [auto, selected, target]);
  const pick = (id) => (setAuto(false), setTarget(id === selected ? null : id));
  const arrive = (id) => (setSelected(id), setTarget(null));
  const stage = stages.find((s) => s.id === selected);
  const color = colors[selected] || "#8a93a3";
  const notes = stage?.involved ? callouts(selected, exp) : [];
  // The Proof Checker checks the whole model, so every part takes its colour.
  const tint =
    selected === "verifier" && exp?.guards?.pass
      ? Object.fromEntries(
          ["chassis", "wheels", "lift", "arm", "sensor"].map((p) => [p, color]),
        )
      : {};
  const ref = exp?.reference,
    cand = exp?.candidate;

  return (
    <div className="sg" style={{ "--c": color }}>
      <aside className="sg-left">{head}</aside>

      <div className="sg-center">
        <p className="sg-speaking" key={"s" + selected}>
          <i />
          {stage?.name.codename}{" "}
          <span>
            · {stage?.involved ? stage.name.name : "not involved in this run"}
          </span>
        </p>
        <Model3D
          color={color}
          focus={notes.map((n) => n.part)}
          callouts={notes}
          tint={tint}
          reduced={reduced}
        />
        <PlanetRow
          stages={stages}
          colors={colors}
          selected={selected}
          target={target}
          onArrive={arrive}
          onPick={pick}
          reduced={reduced}
        />
      </div>

      <aside className="sg-right">
        <section className="sg-card sg-agent" key={selected}>
          <span className="eyebrow">
            {stage?.involved ? stage.name.subtitle : "Not involved"}
          </span>
          <h3>
            {stage?.name.codename} <small>{stage?.name.name}</small>
          </h3>
          <p className="sg-desc">{stage?.name.description}</p>
          {stage?.involved ? (
            stage.body
          ) : (
            <p className="not-recorded">
              This role did not run in this workflow.
            </p>
          )}
        </section>
        <section className="sg-card sg-measure">
          <span className="eyebrow">Reference → candidate</span>
          <ul className="sg-bars">
            {BARS.map(([label, key, digits, unit], i) => {
              const a = ref?.[key],
                b = cand?.[key];
              const max = Math.max(a || 0, b || 0) || 1;
              return (
                <li key={key} style={{ "--i": i }}>
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
  );
}
