import React from "react";
import AgentField from "./AgentField.jsx";
import "./loading.css";

// Shown while a run is live: the goal, what the run is doing now, and the four
// agents (the stages of the run) working on the project.
export default function Loading({
  job,
  project,
  baselineSrc,
  inert,
  goal,
  preview,
}) {
  return (
    <section className="loading" aria-label="Sift is working" inert={inert}>
      <div className="loading-inner">
        <div className="loading-copy">
          <span className="eyebrow">
            {preview
              ? "Preview"
              : job.status === "queued"
                ? "Queued"
                : job.kind === "optimize"
                  ? "Improving performance"
                  : "Building & measuring"}
          </span>
          <h1>
            {job.status === "queued"
              ? "Waiting for the local worker"
              : "Agents at work"}
          </h1>
          <p aria-live="polite">{job.phase || "Starting…"}</p>
          {preview && (
            <p className="loading-preview">
              Nothing is running. This is how Sift looks while it works.
            </p>
          )}
          {(job.mission || goal) && (
            <blockquote>
              <span>Your goal</span>
              {job.mission || goal}
            </blockquote>
          )}
          <p className="loading-hint">
            Click an agent to see what it is working on.
          </p>
        </div>
        <AgentField
          job={job}
          project={project}
          baselineSrc={baselineSrc}
          preview={preview}
        />
      </div>
    </section>
  );
}
