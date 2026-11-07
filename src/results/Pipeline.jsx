import React, { useEffect, useRef, useState } from "react";
import { NAMES, HANDOFFS } from "../agentNames.js";
import { useInView, useSprings } from "./motion.js";

// The run drawn as one isometric machine. Each assembly is a pipeline stage and
// the pipes between them are the three recorded local handoffs. At rest it is
// assembled; on hover, scroll or the button it comes apart with staggered springs
// and every assembly shows the evidence the backend recorded for it.

const COS = Math.cos(Math.PI / 6),
  SIN = 0.5;
const iso = (x, y, z) => [(x - y) * COS, (x + y) * SIN - z];
const pts = (list) =>
  list
    .map((p) =>
      iso(...p)
        .map((n) => n.toFixed(1))
        .join(","),
    )
    .join(" ");

function Block({ w, d, h, z = 0, fill, line = "rgba(15,23,42,.55)" }) {
  const x = -w / 2,
    y = -d / 2;
  return (
    <g stroke={line} strokeWidth=".8" strokeLinejoin="round">
      <polygon
        fill={fill}
        fillOpacity=".55"
        points={pts([
          [x, y + d, z],
          [x + w, y + d, z],
          [x + w, y + d, z + h],
          [x, y + d, z + h],
        ])}
      />
      <polygon
        fill={fill}
        fillOpacity=".8"
        points={pts([
          [x + w, y, z],
          [x + w, y + d, z],
          [x + w, y + d, z + h],
          [x + w, y, z + h],
        ])}
      />
      <polygon
        fill={fill}
        fillOpacity=".25"
        points={pts([
          [x, y, z + h],
          [x + w, y, z + h],
          [x + w, y + d, z + h],
          [x, y + d, z + h],
        ])}
      />
    </g>
  );
}

// Engraved tops that tell the stages apart. The Proof Checker is a stamping press
// with a gear: a machine, not a robot or a brain, because it is plain code.
function Detail({ kind, color }) {
  const top = (x, y) => iso(x, y, 62);
  const [cx, cy] = top(0, 0);
  if (kind === "investigator")
    return (
      <g stroke={color} fill="none" strokeWidth="1.4">
        <ellipse cx={cx} cy={cy - 14} rx="16" ry="9" />
        <ellipse
          cx={cx}
          cy={cy - 14}
          rx="8"
          ry="4.5"
          fill={color}
          fillOpacity=".25"
        />
        <line x1={cx} y1={cy} x2={cx} y2={cy - 5} />
      </g>
    );
  if (kind === "optimizer")
    return (
      <g stroke={color} fill={color} fillOpacity=".25" strokeWidth="1.4">
        <path
          d={`M${cx - 6} ${cy - 30} L${cx + 6} ${cy - 30} L${cx + 6} ${cy - 12} L${cx} ${cy - 2} L${cx - 6} ${cy - 12} Z`}
        />
        <line x1={cx} y1={cy - 12} x2={cx} y2={cy - 4} />
      </g>
    );
  if (kind === "risk")
    return (
      <g stroke={color} fill="none" strokeWidth="1.4">
        <path d={`M${cx - 16} ${cy - 8} A16 16 0 0 1 ${cx + 16} ${cy - 8}`} />
        <line x1={cx} y1={cy - 8} x2={cx + 9} y2={cy - 19} />
        <circle cx={cx} cy={cy - 8} r="2" fill={color} />
      </g>
    );
  const teeth = Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2;
    return (
      <line
        key={i}
        x1={cx + Math.cos(a) * 10}
        y1={cy - 12 + Math.sin(a) * 6}
        x2={cx + Math.cos(a) * 14}
        y2={cy - 12 + Math.sin(a) * 8.4}
      />
    );
  });
  return (
    <g stroke={color} fill="none" strokeWidth="1.3">
      <ellipse cx={cx} cy={cy - 12} rx="10" ry="6" />
      {teeth}
      <rect
        x={cx - 4}
        y={cy - 34}
        width="8"
        height="14"
        fill={color}
        fillOpacity=".25"
      />
    </g>
  );
}

const pass = (c) =>
  c.visualPass &&
  c.statePass &&
  c.pickingPass !== false &&
  c.cameraPass !== false;

function Gauges({ risk }) {
  const probs = risk?.probabilities;
  if (!probs)
    return <p className="not-recorded">Risk probabilities not recorded.</p>;
  const threshold = Number.isFinite(risk.threshold) ? risk.threshold : null;
  return (
    <ul className="gauges">
      {Object.entries(probs).map(([name, p]) => (
        <li
          key={name}
          className={risk.selectedRisks?.includes(name) ? "selected" : ""}
        >
          <span>{name}</span>
          <span className="gauge-track">
            <i style={{ "--p": p }} />
            {threshold != null && (
              <b
                style={{ left: threshold * 100 + "%" }}
                title={"threshold " + threshold}
              />
            )}
          </span>
          <code>{Number(p).toFixed(2)}</code>
        </li>
      ))}
      {threshold != null && (
        <li className="gauge-note">
          Line = {threshold} threshold. Above it, extra checks were added.
        </li>
      )}
    </ul>
  );
}

function Checkpoints({ checks, go, reduced }) {
  const [lit, setLit] = useState(reduced ? checks.length : 0);
  useEffect(() => {
    if (!go || reduced) return setLit(go || reduced ? checks.length : 0);
    let n = 0;
    const timer = setInterval(() => {
      setLit(++n);
      if (n >= checks.length) clearInterval(timer);
    }, 110);
    return () => clearInterval(timer);
  }, [go, reduced, checks.length]);
  return (
    <div
      className="checkgrid"
      role="img"
      aria-label={`${checks.filter(pass).length} of ${checks.length} checkpoints passed`}
    >
      {checks.map((c, i) => (
        <i
          key={i}
          className={i < lit ? (pass(c) ? "ok" : "bad") : ""}
          title={`view ${c.view} · t=${c.time}s`}
        />
      ))}
    </div>
  );
}

const Tools = ({ trace }) =>
  trace?.length ? (
    <ol className="tools">
      {trace
        .filter((t) => t.tool)
        .map((t, i) => (
          <li key={i} className={t.ok === false ? "failed" : ""}>
            <code>{t.tool}</code>
            {t.path && <span>{t.path}</span>}
          </li>
        ))}
    </ol>
  ) : (
    <p className="not-recorded">No tool calls recorded.</p>
  );

export default function Pipeline({ experiment: exp, colors, reduced }) {
  const ref = useRef(null);
  const seen = useInView(ref, 0.35);
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const apart = open || hover || seen;

  const cited = [
    ...new Set(
      (exp?.investigation?.evidence || []).map((e) => e.path).filter(Boolean),
    ),
  ];
  const patched = [...(exp?.diff || "").matchAll(/^\+\+\+ b\/(.+)$/gm)].map(
    (m) => m[1],
  );
  const checks = exp?.guards?.checks || [];
  const stages = [
    {
      id: "investigator",
      name: NAMES.investigator,
      involved: Boolean(exp?.investigation || exp?.investigatorTrace?.length),
      body: (
        <>
          {exp?.investigation?.hypothesis ? (
            <p className="quote">{exp.investigation.hypothesis}</p>
          ) : (
            <p className="not-recorded">No hypothesis recorded.</p>
          )}
          {cited.length > 0 && (
            <p className="files">
              Cited:{" "}
              {cited.map((p) => (
                <code key={p}>{p}</code>
              ))}
            </p>
          )}
          <Tools trace={exp?.investigatorTrace} />
        </>
      ),
    },
    {
      id: "optimizer",
      name: NAMES.optimizer,
      involved: Boolean(exp?.diff || exp?.trace?.length),
      body: (
        <>
          {exp?.title && <p className="quote">{exp.title}</p>}
          <Tools trace={exp?.trace} />
          {patched.length > 0 && (
            <p className="files">
              Patched:{" "}
              {patched.map((p) => (
                <code key={p}>{p}</code>
              ))}
            </p>
          )}
        </>
      ),
    },
    {
      id: "risk",
      name: NAMES.risk,
      involved: Boolean(exp?.riskAssessment),
      body: (
        <>
          {exp?.riskAssessment?.model && (
            <p className="meta">
              {exp.riskAssessment.provider} · {exp.riskAssessment.model}
            </p>
          )}
          <Gauges risk={exp?.riskAssessment} />
        </>
      ),
    },
    {
      id: "verifier",
      name: NAMES.verifier,
      involved: Boolean(exp?.guards),
      body: checks.length ? (
        <>
          <Checkpoints checks={checks} go={apart} reduced={reduced} />
          <p className="meta">
            {checks.filter(pass).length} of {checks.length} checkpoints pass
            {exp.guards.coverage?.semanticObjects
              ? ` · ${exp.guards.coverage.semanticObjects.toLocaleString()} objects`
              : ""}
            {exp.guards.coverage?.pickingProbes
              ? ` · ${exp.guards.coverage.pickingProbes} picking probes`
              : ""}
          </p>
        </>
      ) : (
        <p className="not-recorded">No checkpoints recorded.</p>
      ),
    },
  ];
  const t = useSprings(
    stages.map(() => (apart ? 1 : 0)),
    { reduced, stagger: 0.09 },
  );
  const handoffs = Object.keys(HANDOFFS).map((stage) =>
    exp?.handoffs?.findLast?.((h) => h.stage === stage),
  );

  // Assembled: blocks touch. Apart: spread out and lifted alternately.
  const place = (i, e) => [
    130 + i * (150 + 80 * e),
    205 - (i % 2 ? 26 : -6) * e - 18 * e,
  ];

  return (
    <div className="pipeline" ref={ref}>
      <div
        className="machine"
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
      >
        <svg
          viewBox="0 -60 960 390"
          role="img"
          aria-label="The run's pipeline as a machine: four stages joined by three handoffs"
        >
          {[
            [0, 1, 0],
            [1, 2, 1],
            [2, 3, null],
          ].map(([from, to, h]) => {
            const [x1, y1] = place(from, t[from]);
            const [x2, y2] = place(to, t[to]);
            const rec = h == null ? true : handoffs[h];
            return (
              <g
                key={from}
                className={
                  "pipe" + (rec ? "" : " missing") + (h == null ? " inner" : "")
                }
              >
                <path
                  d={`M${x1 + 44} ${y1 - 18} C ${x1 + 90} ${y1 - 18}, ${x2 - 90} ${y2 - 18}, ${x2 - 44} ${y2 - 18}`}
                />
                {h != null && (
                  <text
                    x={(x1 + x2) / 2}
                    y={Math.min(y1, y2) - 34}
                    textAnchor="middle"
                    opacity={t[from]}
                  >
                    {Object.keys(HANDOFFS)[h]}
                  </text>
                )}
              </g>
            );
          })}
          {(() => {
            // The result travels back from the Proof Checker to the Bottleneck Finder.
            const [x1, y1] = place(3, t[3]);
            const [x2, y2] = place(0, t[0]);
            const lift = 150 + 40 * t[3];
            return (
              <g className={"pipe return" + (handoffs[2] ? "" : " missing")}>
                <path
                  d={`M${x1} ${y1 - 60} C ${x1} ${y1 - lift}, ${x2} ${y2 - lift}, ${x2} ${y2 - 60}`}
                />
                <text
                  x={(x1 + x2) / 2}
                  y={Math.min(y1, y2) - lift * 0.75 - 4}
                  textAnchor="middle"
                  opacity={t[3]}
                >
                  VerificationResult
                </text>
              </g>
            );
          })()}
          {stages.map((s, i) => {
            const [x, y] = place(i, t[i]);
            const color = s.involved ? colors[s.id] : "#b7bcc6";
            return (
              <g
                key={s.id}
                transform={`translate(${x} ${y})`}
                className={s.involved ? "" : "idle"}
              >
                <ellipse
                  cx="0"
                  cy="34"
                  rx={56 + 8 * t[i]}
                  ry={18 + 3 * t[i]}
                  fill="rgba(15,23,42,.08)"
                />
                <Block w={74} d={74} h={14} fill="#dfe3ea" />
                <g transform={`translate(0 ${-26 * t[i]})`}>
                  <Block w={60} d={60} h={46} z={14} fill={color} />
                  <Detail
                    kind={s.id}
                    color={s.involved ? "#0f172a" : "#9aa1ad"}
                  />
                </g>
                <text y="64" textAnchor="middle" className="stage-name">
                  {s.name.name}
                </text>
                <text y="80" textAnchor="middle" className="stage-sub">
                  {s.involved ? s.name.subtitle : "not involved"}
                </text>
              </g>
            );
          })}
        </svg>
        <button
          type="button"
          className="ghost"
          onClick={() => setOpen(!apart)}
          aria-pressed={apart}
        >
          {apart ? "Put it back together" : "Take it apart"}
        </button>
      </div>
      <ol className="stage-cards">
        {stages.map((s, i) => (
          <li
            key={s.id}
            className={"stage-card" + (s.involved ? "" : " idle")}
            style={{
              "--c": colors[s.id],
              opacity: 0.15 + 0.85 * t[i],
              transform: `translateY(${(1 - t[i]) * 14}px)`,
            }}
          >
            <header>
              <b>{s.name.name}</b>
              <span>{s.involved ? s.name.subtitle : "not involved"}</span>
            </header>
            {s.involved ? (
              s.body
            ) : (
              <p className="not-recorded">
                This role did not run in this workflow.
              </p>
            )}
            {[0, 1, null, 2][i] != null && (
              <p className="handoff">
                {HANDOFFS[Object.keys(HANDOFFS)[[0, 1, null, 2][i]]]}
                {handoffs[[0, 1, null, 2][i]]?.utc ? (
                  <time>
                    {" "}
                    ·{" "}
                    {new Date(
                      handoffs[[0, 1, null, 2][i]].utc,
                    ).toLocaleTimeString()}
                  </time>
                ) : (
                  <em> · not recorded</em>
                )}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
