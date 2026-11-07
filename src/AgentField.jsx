import React, { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { X } from "lucide-react";
import "./agents.css";

// The four kinds of work in a Sift run, each drawn as an agent. Every agent's state,
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
    at: [170, 120],
  },
  {
    id: "gauge",
    name: "Gauge",
    role: "Measures how it runs",
    color: "#0fa58c",
    types: ["profile", "benchmark", "complete"],
    waiting: "Will measure the scene on this machine.",
    at: [830, 120],
  },
  {
    id: "smith",
    name: "Smith",
    role: "Writes a candidate patch",
    color: "#7a52ff",
    types: ["agent", "repair", "inconclusive"],
    waiting: "Will read the measurements and propose a fix.",
    at: [830, 440],
  },
  {
    id: "warden",
    name: "Warden",
    role: "Checks it looks and behaves the same",
    color: "#e0602c",
    types: ["verify", "accepted", "rejected"],
    waiting: "Will compare frames, objects and picking.",
    at: [170, 440],
  },
];
const CENTER = [500, 280];
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

// A curved spoke from an agent to the project in the middle.
const spoke = ([x, y]) => {
  const [cx, cy] = CENTER,
    mx = (x + cx) / 2;
  return `M${x} ${y} C ${mx} ${y}, ${mx} ${cy}, ${cx + (x < cx ? -120 : 120)} ${cy}`;
};
// A hand-off arc between two neighbouring agents, bowed away from the centre.
const handoff = ([x1, y1], [x2, y2]) => {
  const mx = (x1 + x2) / 2,
    my = (y1 + y2) / 2,
    bx = mx + (mx - CENTER[0]) * 0.35,
    by = my + (my - CENTER[1]) * 0.35;
  return `M${x1} ${y1} Q ${bx} ${by} ${x2} ${y2}`;
};

function Avatar({ id, working }) {
  const cls = "avatar " + (working ? "working" : "");
  if (id === "scout")
    return (
      <svg className={cls} viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <linearGradient id="scout-beam" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#5fa0ff" stopOpacity=".55" />
            <stop offset="1" stopColor="#5fa0ff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon
          className="scout-beam"
          points="32,30 14,62 50,62"
          fill="url(#scout-beam)"
        />
        <path
          d="M32 5C32 5 13 24 13 36a19 19 0 0 0 38 0C51 24 32 5 32 5Z"
          fill="#2f6bff"
        />
        <path
          d="M22 30c1-5 4-9 7-12"
          stroke="#fff"
          strokeOpacity=".6"
          strokeWidth="2.4"
          fill="none"
          strokeLinecap="round"
        />
        <circle cx="32" cy="36" r="10" fill="#0b1a44" />
        <circle className="scout-lens" cx="32" cy="36" r="7" fill="#9cc4ff" />
        <circle cx="35" cy="33" r="2.2" fill="#fff" />
        <circle
          cx="32"
          cy="36"
          r="10"
          fill="none"
          stroke="#cfe0ff"
          strokeWidth="1.6"
        />
      </svg>
    );
  if (id === "gauge")
    return (
      <svg className={cls} viewBox="0 0 64 64" aria-hidden="true">
        <line
          x1="32"
          y1="9"
          x2="32"
          y2="3"
          stroke="#0fa58c"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <circle className="gauge-ping" cx="32" cy="3" r="2.6" fill="#7ff0d8" />
        <circle cx="32" cy="34" r="23" fill="#0fa58c" />
        <circle cx="32" cy="34" r="16" fill="#e9fffa" />
        {Array.from({ length: 9 }, (_, i) => {
          const a = Math.PI * (0.85 + (i / 8) * 1.3);
          return (
            <line
              key={i}
              x1={32 + Math.cos(a) * 13}
              y1={34 + Math.sin(a) * 13}
              x2={32 + Math.cos(a) * 15.5}
              y2={34 + Math.sin(a) * 15.5}
              stroke="#0b4f45"
              strokeWidth="1.4"
            />
          );
        })}
        <g className="gauge-needle">
          <line
            x1="32"
            y1="34"
            x2="32"
            y2="22"
            stroke="#e0602c"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </g>
        <circle cx="32" cy="34" r="2.6" fill="#0b4f45" />
        <circle cx="26" cy="43" r="1.6" fill="#0b4f45" />
        <circle cx="38" cy="43" r="1.6" fill="#0b4f45" />
        <rect x="20" y="55" width="7" height="5" rx="2.5" fill="#0b7a69" />
        <rect x="37" y="55" width="7" height="5" rx="2.5" fill="#0b7a69" />
      </svg>
    );
  if (id === "smith")
    return (
      <svg className={cls} viewBox="0 0 64 64" aria-hidden="true">
        <rect x="12" y="14" width="40" height="40" rx="11" fill="#7a52ff" />
        <rect x="12" y="14" width="40" height="14" rx="7" fill="#9b7cff" />
        <rect x="18" y="31" width="28" height="9" rx="4.5" fill="#1b0f4a" />
        <rect
          className="smith-eye"
          x="22"
          y="34"
          width="6"
          height="3"
          rx="1.5"
          fill="#bda9ff"
        />
        <rect
          className="smith-eye"
          x="36"
          y="34"
          width="6"
          height="3"
          rx="1.5"
          fill="#bda9ff"
        />
        <g className="smith-tool">
          <path
            d="M50 44 l9 -9 a5 5 0 1 1 3 3 l-9 9 z"
            fill="#cfd5e3"
            stroke="#5b6478"
            strokeWidth="1"
          />
        </g>
        <g className="smith-sparks">
          <circle cx="58" cy="30" r="1.4" fill="#ffd166" />
          <circle cx="61" cy="36" r="1" fill="#ffb340" />
          <circle cx="55" cy="27" r="1" fill="#ffe08a" />
        </g>
      </svg>
    );
  return (
    <svg className={cls} viewBox="0 0 64 64" aria-hidden="true">
      <circle
        className="warden-ring"
        cx="32"
        cy="32"
        r="29"
        fill="none"
        stroke="#e0602c"
        strokeOpacity=".35"
        strokeWidth="1.5"
        strokeDasharray="4 5"
      />
      <path
        d="M32 7 L52 14 V32 C52 45 42 53 32 57 C22 53 12 45 12 32 V14 Z"
        fill="#e0602c"
      />
      <path d="M32 11 L48 17 V31 C48 41 41 48 32 52 Z" fill="#f08a5d" />
      <path
        className="warden-check"
        d="M22 31 L29 38 L43 24"
        fill="none"
        stroke="#fff"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength="1"
      />
    </svg>
  );
}

export default function AgentField({ job, project, baselineSrc, preview }) {
  const [selected, setSelected] = useState(null);
  const active = activeAgent(job);
  const events = job.events || [];
  const files = (project?.discovery?.files || [])
    .map((f) => f.path)
    .concat(project?.config?.editableFiles || [])
    .filter((p, i, all) => p && all.indexOf(p) === i);
  const exp = job.experiments?.at(-1);
  const info = AGENTS.map((a) => {
    const mine = events.filter((e) => a.types.includes(e.type));
    const state =
      a.id === active ? "working" : mine.length ? "done" : "waiting";
    const task =
      state === "working"
        ? job.phase || mine.at(-1)?.message || a.role
        : mine.at(-1)?.message || a.waiting;
    return { ...a, mine, state, task };
  });
  const pick = (id) => {
    const next = selected === id ? null : id;
    const apply = () => flushSync(() => setSelected(next));
    if (
      document.startViewTransition &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      document.startViewTransition(apply);
    else apply();
  };
  useEffect(() => {
    if (!selected) return;
    const key = (e) => e.key === "Escape" && pick(selected);
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [selected]);
  const chosen = info.find((a) => a.id === selected);
  const statusText = { working: "Working", done: "Done", waiting: "Waiting" };
  return (
    <div className={"field-wrap " + (chosen ? "has-detail" : "")}>
      <div className="agent-field">
        <svg className="field-links" viewBox="0 0 1000 560" aria-hidden="true">
          {info.map((a, i) => {
            const next = info[(i + 1) % info.length];
            if (i === info.length - 1) return null;
            const lit = a.state === "done" && next.state !== "waiting";
            return (
              <path
                key={"h" + a.id}
                className={
                  "link handoff " +
                  (lit ? "lit " : "") +
                  (chosen && chosen.id !== a.id && chosen.id !== next.id
                    ? "dim"
                    : "")
                }
                d={handoff(a.at, next.at)}
                pathLength="1"
                style={{ "--c": next.color, "--d": `${0.5 + i * 0.12}s` }}
              />
            );
          })}
          {info.map((a, i) => (
            <g
              key={"s" + a.id}
              className={chosen && chosen.id !== a.id ? "dim" : ""}
            >
              <path
                className={
                  "link spoke " +
                  a.state +
                  (chosen?.id === a.id ? " chosen" : "")
                }
                d={spoke(a.at)}
                pathLength="1"
                style={{ "--c": a.color, "--d": `${0.3 + i * 0.1}s` }}
              />
              {a.state === "working" && (
                <>
                  <path
                    className="flow"
                    d={spoke(a.at)}
                    pathLength="1"
                    style={{ "--c": a.color }}
                  />
                  {[0, 0.6, 1.2].map((b) => (
                    <circle
                      key={b}
                      r="5"
                      className="packet"
                      style={{ fill: a.color }}
                    >
                      <animateMotion
                        dur="1.8s"
                        begin={`${b}s`}
                        repeatCount="indefinite"
                        path={spoke(a.at)}
                      />
                    </circle>
                  ))}
                </>
              )}
            </g>
          ))}
        </svg>
        <div className={"core " + (active ? "busy" : "")}>
          <span className="core-ring" aria-hidden="true" />
          <b>{project?.name || "Your project"}</b>
          <ul>
            {(files.length ? files.slice(0, 4) : ["source files"]).map((f) => (
              <li key={f}>{f}</li>
            ))}
            {files.length > 4 && <li>+{files.length - 4} more</li>}
          </ul>
        </div>
        {info.map((a, i) => (
          <button
            key={a.id}
            type="button"
            className={
              "agent-node " + a.state + (selected === a.id ? " selected" : "")
            }
            style={{
              left: `${a.at[0] / 10}%`,
              top: `${(a.at[1] / 560) * 100}%`,
              "--c": a.color,
              "--i": i,
            }}
            aria-pressed={selected === a.id}
            aria-label={`${a.name}, ${a.role}. ${statusText[a.state]}. Show what ${a.name} is working on.`}
            onClick={() => pick(a.id)}
          >
            <span
              className="avatar-wrap"
              style={{
                viewTransitionName:
                  selected === a.id ? "none" : `agent-${a.id}`,
              }}
            >
              <Avatar id={a.id} working={a.state === "working"} />
            </span>
            <span className="agent-name">{a.name}</span>
            <span className={"agent-state " + a.state}>
              {statusText[a.state]}
            </span>
          </button>
        ))}
      </div>
      {chosen && (
        <aside
          className="agent-detail"
          style={{ "--c": chosen.color }}
          aria-label={`${chosen.name} details`}
        >
          <header>
            <span
              className="avatar-wrap big"
              style={{ viewTransitionName: `agent-${chosen.id}` }}
            >
              <Avatar id={chosen.id} working={chosen.state === "working"} />
            </span>
            <div>
              <h3>{chosen.name}</h3>
              <p>{chosen.role}</p>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="Close"
              onClick={() => pick(chosen.id)}
            >
              <X size={16} />
            </button>
          </header>
          <span className={"agent-state " + chosen.state}>
            {statusText[chosen.state]}
          </span>
          <section>
            <h4>
              {chosen.state === "waiting"
                ? "Up next"
                : chosen.state === "working"
                  ? "Working on"
                  : "Last did"}
            </h4>
            <p className="agent-task">{chosen.task}</p>
          </section>
          {chosen.id === "scout" && files.length > 0 && (
            <section>
              <h4>Files it can read</h4>
              <ul className="agent-files">
                {files.slice(0, 8).map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </section>
          )}
          {chosen.id === "gauge" && (
            <section>
              <h4>Baseline</h4>
              {Number.isFinite(job.baseline?.calls) ? (
                <dl className="agent-stats">
                  <div>
                    <dt>Draw calls</dt>
                    <dd>{job.baseline.calls.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>CPU submit p95</dt>
                    <dd>{job.baseline.submitP95?.toFixed(1)} ms</dd>
                  </div>
                  <div>
                    <dt>Frame p95</dt>
                    <dd>{job.baseline.frameP95?.toFixed(1)} ms</dd>
                  </div>
                </dl>
              ) : (
                <p className="agent-muted">Not measured yet.</p>
              )}
              {baselineSrc && (
                <img
                  className="agent-frame"
                  src={baselineSrc}
                  alt="Baseline frame for this run"
                />
              )}
            </section>
          )}
          {chosen.id === "smith" && (
            <section>
              <h4>Current idea</h4>
              {exp?.title ? (
                <>
                  <p className="agent-idea">{exp.title}</p>
                  {exp.hypothesis && (
                    <p className="agent-muted">{exp.hypothesis}</p>
                  )}
                </>
              ) : (
                <p className="agent-muted">No proposal yet.</p>
              )}
            </section>
          )}
          {chosen.id === "warden" && (
            <section>
              <h4>Checks</h4>
              {exp?.guards?.checks?.length ? (
                <p className="agent-idea">
                  {
                    exp.guards.checks.filter(
                      (c) =>
                        c.visualPass && c.statePass && c.pickingPass !== false,
                    ).length
                  }
                  {" of "}
                  {exp.guards.checks.length} viewpoints match
                </p>
              ) : (
                <p className="agent-muted">Nothing to check yet.</p>
              )}
            </section>
          )}
          <section>
            <h4>Log</h4>
            {chosen.mine.length ? (
              <ol className="agent-log">
                {chosen.mine.slice(-5).map((e, i) => (
                  <li key={i}>{e.message}</li>
                ))}
              </ol>
            ) : (
              <p className="agent-muted">Nothing logged yet.</p>
            )}
          </section>
          <p className="agent-foot">
            {preview
              ? "Preview: nothing is running."
              : "One of four stages of this run, shown as an agent."}
          </p>
        </aside>
      )}
    </div>
  );
}
