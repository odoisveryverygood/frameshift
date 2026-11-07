import React from "react";
import "./loading.css";

const stages = [
  ["Build", ["building"]],
  ["Measure", ["profile", "measuring"]],
  ["Patch", ["reasoning"]],
  ["Check", ["verifying", "checking", "benchmarking"]],
];
const palette = [
  "#7fd4ff",
  "#4fb0ff",
  "#3d8bff",
  "#62c7ff",
  "#5aa2ff",
  "#8fdcff",
];

// One cute blue droplet. The face flips with the direction of travel because
// its animation lasts exactly one full there-and-back patrol.
function Agent({ index, duration, delay }) {
  return (
    <span
      className="agent"
      style={{
        "--d": `${duration}s`,
        "--delay": `${delay}s`,
        "--tint": palette[index % palette.length],
      }}
      aria-hidden="true"
    >
      <span className="agent-face">
        <svg viewBox="0 0 32 36" width="27" height="30">
          <ellipse className="agent-ripple" cx="16" cy="33" rx="9" ry="2.2" />
          <g className="agent-leg-a">
            <rect x="10" y="26" width="3.4" height="7" rx="1.7" />
          </g>
          <g className="agent-leg-b">
            <rect x="18.6" y="26" width="3.4" height="7" rx="1.7" />
          </g>
          <path
            className="agent-body"
            d="M16 1.5C16 1.5 3.5 14 3.5 21.5a12.5 12.5 0 0 0 25 0C28.5 14 16 1.5 16 1.5Z"
          />
          <path
            className="agent-shine"
            d="M9.5 19.5c.4-3.2 2-5.6 3.8-7.6"
            fill="none"
          />
          <circle cx="12" cy="21" r="3.1" fill="#fff" />
          <circle cx="20.5" cy="21" r="3.1" fill="#fff" />
          <circle className="agent-pupil" cx="13" cy="21.4" r="1.5" />
          <circle className="agent-pupil" cx="21.5" cy="21.4" r="1.5" />
          <path
            d="M13.2 26.2q3 2.2 5.9 0"
            fill="none"
            stroke="#0b2a66"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </span>
    </span>
  );
}

// Shown while a run is live. The agents are an illustration of the work; the
// document rows, goal, step and log lines are the run's real data.
export default function Loading({ job, project, baselineSrc, inert, goal }) {
  const files = (
    project?.discovery?.files?.filter((f) => f.usesThree).length
      ? project.discovery.files.filter((f) => f.usesThree)
      : project?.discovery?.files || []
  )
    .map((f) => f.path)
    .concat(project?.config?.editableFiles || [])
    .filter((p, i, all) => p && all.indexOf(p) === i)
    .slice(0, 7);
  const rows = files.length ? files : [null, null, null, null, null];
  const status = job.experiments?.at(-1)?.status;
  const logged = (type) => (job.events || []).some((e) => e.type === type);
  const current =
    job.status === "queued"
      ? -1
      : job.kind !== "optimize" || !job.baseline
        ? logged("profile") || job.baseline
          ? 1
          : 0
        : status === "reasoning"
          ? 2
          : ["verifying", "checking", "benchmarking"].includes(status)
            ? 3
            : 2;
  // More lines per file when there are few files, so the document never looks empty.
  const lines = rows.length <= 2 ? 4 : rows.length <= 4 ? 3 : 2;
  const events = (job.events || []).slice(-4);
  return (
    <section className="loading" aria-label="Sift is working" inert={inert}>
      <div className="loading-inner">
        <div className="loading-copy">
          <span className="eyebrow">
            {job.status === "queued"
              ? "Queued"
              : job.kind === "optimize"
                ? "Improving performance"
                : "Building & measuring"}
          </span>
          <h1>
            {job.status === "queued"
              ? "Waiting for the local worker"
              : "Reading your project"}
          </h1>
          <p aria-live="polite">{job.phase || "Starting…"}</p>
          {(job.mission || goal) && (
            <blockquote>
              <span>Your goal</span>
              {job.mission || goal}
            </blockquote>
          )}
        </div>
        <div
          className="doc"
          role="img"
          aria-label="Illustration: small blue agents running along the lines of your project files"
        >
          <header>
            <i />
            <i />
            <i />
            <span>{project?.name || "project"}</span>
          </header>
          <div className="doc-rows">
            {rows.map((path, r) => (
              <div
                key={path || r}
                className="doc-row"
                style={{ "--i": r, "--n": rows.length }}
              >
                <span className="doc-label">{path || "\u00a0"}</span>
                {Array.from({ length: lines }, (_, l) => {
                  const k = r * lines + l;
                  return (
                    <span className="doc-line" key={l}>
                      <b style={{ width: `${34 + ((k * 37) % 46)}%` }} />
                      <b style={{ width: `${12 + ((k * 53) % 28)}%` }} />
                      <Agent
                        index={k}
                        duration={3 + ((k * 0.73) % 3.2)}
                        delay={-((k * 1.37) % 5)}
                      />
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <aside className="loading-side">
          <ol className="loading-steps" aria-label="Progress">
            {stages.map(([label], i) => (
              <li
                key={label}
                className={
                  i === current ? "current" : i < current ? "done" : ""
                }
                aria-current={i === current ? "step" : undefined}
              >
                <span aria-hidden="true">{i < current ? "✓" : i + 1}</span>
                {label}
              </li>
            ))}
          </ol>
          {baselineSrc && (
            <figure className="loading-frame">
              <img
                src={baselineSrc}
                alt="Baseline frame captured for this run"
                onError={(e) => (e.currentTarget.style.display = "none")}
              />
              <figcaption>Baseline frame · paused for measurement</figcaption>
            </figure>
          )}
          <ul className="loading-log">
            {events.map((e, i) => (
              <li key={i}>
                <i aria-hidden="true" />
                {e.message}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </section>
  );
}
