import React from "react";
import {
  ArrowUpRight,
  Box,
  Check,
  Code2,
  GitBranch,
  Loader2,
  ScanLine,
  ShieldCheck,
  X,
} from "lucide-react";

export function SelectionPin({
  context,
  finding,
  busy,
  onInvestigate,
  onImprove,
  onChallenge,
  onSource,
  onClear,
}) {
  const selected = context?.selected || context?.selection;
  if (!selected?.id) return null;
  const anchor = selected.anchor;
  const x = anchor?.visible ? Math.max(5, Math.min(72, anchor.x * 100 + 3)) : 5;
  const y = anchor?.visible
    ? Math.max(12, Math.min(55, anchor.y * 100 - 6))
    : 18;
  const refs = [
    ...(finding?.sourceReferences ||
      finding?.sourceAssociations ||
      finding?.sources ||
      []),
    ...(finding?.evidence || []),
  ];
  const source = Array.isArray(refs) ? refs[0] : null;
  return (
    <article
      className="spatial-pin"
      style={{ left: `${x}%`, top: `${y}%` }}
      aria-label="Selected scene object"
    >
      <div className="pin-heading">
        <span>
          <Box size={13} />
          {selected.name || selected.id}
        </span>
        <button aria-label="Clear selection" onClick={onClear}>
          <X size={13} />
        </button>
      </div>
      <p className="pin-identity">
        {selected.instanceId != null
          ? `Instance ${selected.instanceId} · `
          : ""}
        {selected.groupInstanceCount > 1
          ? `${selected.groupInstanceCount.toLocaleString()} instances in this mesh`
          : selected.type || "Scene object"}
      </p>
      {finding ? (
        <>
          <span className="pin-confidence">HYPOTHESIS · {finding.provider === "gemini" ? "ARGON" : "INVESTIGATOR"}</span>
          <p className="pin-finding">
            {finding.hypothesis ||
              finding.summary ||
              finding.finding ||
              finding.title}
          </p>
          <span className="pin-confidence">
            {finding.stale
              ? "Source changed · investigate again"
              : `Source association · ${finding.sourceConfidence || "inferred"}`}
          </span>
        </>
      ) : (
        <p className="pin-finding">
          Ask Earl about this object and its rendering code.
        </p>
      )}
      {source && (
        <button
          className="pin-source"
          onClick={() => onSource(source.path || source.file || source)}
        >
          <Code2 size={12} />
          {source.path || source.file || source}{" "}
          <span>{source.confidence || "association"}</span>
        </button>
      )}
      <div className="pin-actions">
        <button onClick={onInvestigate} disabled={busy}>
          {busy ? (
            <Loader2 size={12} className="spin" />
          ) : (
            <ScanLine size={12} />
          )}
          Investigate
        </button>
        <button onClick={onChallenge} disabled={busy}>
          <ShieldCheck size={12} />
          Challenge
        </button>
        <button
          onClick={onImprove}
          disabled={busy}
          title="Improve the selected object"
        >
          <ArrowUpRight size={13} />
        </button>
      </div>
    </article>
  );
}

export function InvestigationRibbon({
  finding,
  challenges,
  onOpen,
  onChallenge,
  recording,
  onStop,
}) {
  const challenge = challenges?.[0];
  if (recording)
    return (
      <div className="spatial-ribbon is-recording">
        <span className="record-dot" />
        <p>
          <b>Selection at this captured moment.</b> Click the object that must
          still be selectable.
        </p>
        <button onClick={onStop}>
          Save & test <ArrowUpRight size={12} />
        </button>
      </div>
    );
  if (challenge)
    return (
      <div className={"spatial-ribbon challenge-" + challenge.status}>
        <ShieldCheck size={15} />
        <p>
          <b>
            {challenge.status === "passed" || challenge.status === "accepted"
              ? "Challenge passed"
              : challenge.status === "failed" || challenge.status === "rejected"
                ? "Challenge needs attention"
                : "Challenge " + challenge.status}
          </b>
          <span>
            {challenge.reason ||
              challenge.message ||
              "Original and current workspace · recorded interaction"}
          </span>
        </p>
        <button onClick={onChallenge}>
          Inspect <ArrowUpRight size={12} />
        </button>
      </div>
    );
  if (!finding)
    return (
      <div className="spatial-ribbon spatial-hint">
        <ScanLine size={14} />
        <p>
          Click an object in the scene. Ask why it is expensive. Challenge what
          must stay correct.
        </p>
      </div>
    );
  return (
    <div className="spatial-ribbon">
      <span className="finding-dot" />
      <p>
        <b>{finding.hypothesis || finding.title || "Investigation ready"}</b>
        <span>
          {finding.stale
            ? "Source changed; this finding needs a fresh investigation."
            : finding.summary ||
              finding.objective ||
              "A source-backed finding is ready to inspect."}
        </span>
      </p>
      <button onClick={onOpen}>
        Evidence <ArrowUpRight size={12} />
      </button>
    </div>
  );
}

export function ExperimentTimeline({ runs, onSelect, onDetails }) {
  const items = runs
    .flatMap((run) => (run.experiments || []).map((exp) => ({ run, exp })))
    .slice(0, 5)
    .reverse();
  if (!items.length) return null;
  return (
    <div className="spatial-timeline" aria-label="Experiment timeline">
      <span>
        <GitBranch size={12} />
        Experiments
      </span>
      <div>
        {items.map(({ run, exp }, i) => (
          <button
            key={exp.id}
            onClick={() => onSelect(run, exp)}
            title={exp.title || exp.status}
          >
            <i className={"timeline-dot " + exp.status} />
            <span>{exp.title || `Experiment ${i + 1}`}</span>
            <small>{exp.status}</small>
          </button>
        ))}
      </div>
      <button className="timeline-details" onClick={onDetails}>
        History <ArrowUpRight size={12} />
      </button>
    </div>
  );
}

export function SpatialEvidence({ findings, challenges, onSource }) {
  return (
    <div className="spatial-evidence-list">
      {challenges.map((c) => (
        <article key={c.id}>
          <span className="overline">
            SELECTION CHALLENGE · {c.stale ? "SOURCE CHANGED" : c.status}
          </span>
          <h3>{c.expectedSelection || "Recorded selection"}</h3>
          <p>
            {c.error ||
              c.reason ||
              c.result?.reason ||
              "Replay the same interaction against the original and current workspace."}
          </p>
          {c.images && (
            <div className="challenge-image-pair">
              <figure>
                <img
                  src={c.images.reference}
                  alt="Original scene after the recorded challenge"
                />
                <figcaption>Original</figcaption>
              </figure>
              <figure>
                <img
                  src={c.images.candidate}
                  alt="Current scene after the recorded challenge"
                />
                <figcaption>Current</figcaption>
              </figure>
            </div>
          )}
          <details>
            <summary>Inspect executed check</summary>
            <pre className="code-block">
              {JSON.stringify(c.result || c, null, 2)}
            </pre>
          </details>
        </article>
      ))}
      {findings.map((f) => (
        <article key={f.id}>
          <span className="overline">
            {f.model || f.provider || "Investigator"} ·{" "}
            {f.stale ? "Source changed" : "Finding"}
          </span>
          <h3>{f.hypothesis || f.title || "Investigation"}</h3>
          <p>{f.explanation || f.summary || f.objective}</p>
          {f.screenshotUrl && (
            <figure className="finding-scene-capture">
              <img
                src={f.screenshotUrl}
                alt="Actual scene capture supplied to the Investigator"
              />
              <figcaption>
                Captured scene ·{" "}
                {Number.isFinite(f.context?.time)
                  ? `${f.context.time.toFixed(2)}s`
                  : "recorded view"}
              </figcaption>
            </figure>
          )}
          <div className="finding-facts">
            <span>
              Selected object
              <b>{f.context?.selectedId || f.selectedId || "Scene"}</b>
            </span>
            <span>
              Source association<b>{f.sourceConfidence || "Inferred"}</b>
            </span>
            <span>
              Measured draw calls
              <b>
                {Number.isFinite(f.metrics?.calls)
                  ? f.metrics.calls.toLocaleString()
                  : "Not captured"}
              </b>
            </span>
          </div>
          {f.uncertainty && (
            <p className="finding-uncertainty">{f.uncertainty}</p>
          )}
          {(f.evidence || f.sourceAssociations || []).map((e, i) => (
            <button
              className="finding-source-row"
              key={i}
              onClick={() => onSource(e.path)}
            >
              <Code2 size={13} />
              <span>
                <b>{e.path}</b>
                <small>
                  {e.observation ||
                    e.reason ||
                    e.confidence ||
                    "Inspected source"}
                </small>
              </span>
              <ArrowUpRight size={12} />
            </button>
          ))}
          {f.proposedCheck && (
            <p className="finding-next-check">
              <b>Proposed check</b>
              {typeof f.proposedCheck === "string"
                ? f.proposedCheck
                : JSON.stringify(f.proposedCheck)}
            </p>
          )}
          <details>
            <summary>Full evidence record</summary>
            <pre className="code-block">{JSON.stringify(f, null, 2)}</pre>
          </details>
        </article>
      ))}
      {!findings.length && !challenges.length && (
        <p>Select a part of your scene and ask Earl to investigate it.</p>
      )}
    </div>
  );
}

export function ChallengeMarkers({ challenge, context, capturedContext }) {
  const result = challenge?.result;
  if (
    !result?.testedTargets?.length ||
    !capturedContext ||
    challenge.stale ||
    result.expectedSelection !== capturedContext.selectedId ||
    !context ||
    context.time !== capturedContext.time ||
    JSON.stringify(context.cameraState || context.camera) !==
      JSON.stringify(capturedContext.cameraState || capturedContext.camera)
  )
    return null;
  return (
    <div className="challenge-markers" aria-label="Executed challenge targets">
      {result.testedTargets.map((point, i) => (
        <span
          key={i}
          className={"tested-target " + result.status}
          style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
          title={`Executed click at ${point.time}s`}
        >
          <i />
          <small>
            {result.status === "passed"
              ? "Selection checked"
              : "Checked target"}
          </small>
        </span>
      ))}
    </div>
  );
}
