import React from "react";
import { Check, X, Layers3 } from "lucide-react";

export const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "—");

// Long build errors stay in the log drawer; surfaces show their first line.
export function firstLine(text, max = 180) {
  const line = String(text || "")
    .split("\n")[0]
    .trim();
  return line.length > max ? line.slice(0, max - 1) + "…" : line;
}

// One verdict per finished optimization run, derived from that run alone.
export function runVerdict(run, experiment) {
  if (run.experiments?.some((e) => e.status === "accepted")) return "accepted";
  if (["failed", "stopped", "interrupted"].includes(run.status))
    return run.status;
  if (!experiment) return "no-attempt";
  return experiment.status === "inconclusive" ? "inconclusive" : "rejected";
}

export function Status({ value }) {
  return (
    <span className={"status " + value}>
      <i />
      {value?.replaceAll("-", " ") || "pending"}
    </span>
  );
}

export function Empty({ title, text }) {
  return (
    <div className="empty-detail">
      <Layers3 size={26} strokeWidth={1} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

export function ExperimentSelector({ run, value, onSelect }) {
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

export function Diff({ text }) {
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

export function Evidence({ run, experiment, onSelect }) {
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
