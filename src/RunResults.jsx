import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import Reel from "./results/Reel.jsx";
import Pipeline from "./results/Pipeline.jsx";
import DotCollapse from "./results/DotCollapse.jsx";
import PatchReveal from "./results/PatchReveal.jsx";
import BeforeAfter from "./results/BeforeAfter.jsx";
import Receipt from "./results/Receipt.jsx";
import Stage from "./results/Stage.jsx";
import Galaxy from "./Galaxy.jsx";
import { formatNumber, useInView, useReducedMotion } from "./results/motion.js";
import "./run-results.css";

// One accent per agent, the same colours as the agents screen.
const COLORS = {
  investigator: "#2f6bff",
  optimizer: "#7a52ff",
  risk: "#e0602c",
  verifier: "#0fa58c",
};
const METRICS = [
  ["Draw calls", "calls", 0, ""],
  ["CPU submission p95", "submitP95", 1, " ms"],
  ["Frame p95", "frameP95", 1, " ms"],
];
const SECTIONS = [
  ["summary", "Summary"],
  ["pipeline", "Pipeline"],
  ["patch", "Patch"],
  ["scene", "Scene"],
  ["receipt", "Receipt"],
];
// The verdict shown is only the sealed verifier receipt's status.
const HEADLINE = { accepted: "Verified", rejected: "Rejected" };

// The experiment the verdict belongs to: the accepted one, else the last one
// that reached the checks, else the last attempt (same choice as the workspace).
export const resultExperiment = (run) =>
  run?.experiments?.findLast((e) => e.status === "accepted") ||
  run?.experiments?.findLast((e) => e.guards) ||
  run?.experiments?.at(-1);

function Spotlight({ active, onPick }) {
  const bar = useRef(null);
  const [beam, setBeam] = useState({ x: 0, w: 0 });
  useLayoutEffect(() => {
    const el = bar.current?.querySelector(`[data-id="${active}"]`);
    if (el) setBeam({ x: el.offsetLeft, w: el.offsetWidth });
  }, [active]);
  return (
    <nav className="spotlight" ref={bar} aria-label="Result sections">
      <i
        className="beam"
        style={{ transform: `translateX(${beam.x}px)`, width: beam.w }}
        aria-hidden="true"
      />
      {SECTIONS.map(([id, label]) => (
        <button
          key={id}
          type="button"
          data-id={id}
          aria-current={active === id}
          onClick={() => onPick(id)}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}

export default function RunResults({
  run,
  project,
  onClose,
  fixture,
  measuring,
}) {
  const reduced = useReducedMotion();
  const exp = resultExperiment(run);
  const [receipt, setReceipt] = useState(fixture ? fixture.receipt : undefined);
  const [receiptError, setReceiptError] = useState("");
  const [active, setActive] = useState("summary");
  // Tabs switch views in place; `dir` sets which way the new view slides in.
  const [dir, setDir] = useState(1);

  useEffect(() => {
    if (fixture) return;
    setReceipt(undefined);
    if (!run?.id || !exp?.id) return setReceipt(null);
    let live = true;
    fetch(`/api/runs/${run.id}/experiments/${exp.id}/verdict`)
      .then(async (r) =>
        r.ok
          ? r.json()
          : Promise.reject(
              (await r.json().catch(() => ({}))).error || r.statusText,
            ),
      )
      .then((json) => live && setReceipt(json))
      .catch((e) => live && (setReceipt(null), setReceiptError(String(e))));
    return () => (live = false);
  }, [run?.id, exp?.id, fixture]);

  useEffect(() => {
    const key = (e) => e.key === "Escape" && onClose?.();
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [onClose]);

  const loaded = receipt !== undefined;
  const status = receipt?.verdict?.status;
  const headline = loaded
    ? HEADLINE[status] || "Needs attention"
    : "Reading the receipt…";
  const tone =
    status === "accepted" ? "ok" : status === "rejected" ? "bad" : "warn";
  const reason =
    receipt?.verdict?.reason ||
    (!receipt && loaded
      ? run?.error ||
        exp?.reason ||
        receiptError ||
        "No verifier receipt was recorded for this run."
      : null);
  const ref = exp?.reference,
    cand = exp?.candidate;
  const go = (id) => {
    const order = SECTIONS.map(([k]) => k);
    setDir(order.indexOf(id) >= order.indexOf(active) ? 1 : -1);
    setActive(id);
  };
  const metrics = (
    <div className="metric-cards">
      {METRICS.map(([label, key, digits, unit], i) => {
        const before = formatNumber(ref?.[key], digits),
          after = formatNumber(cand?.[key], digits);
        const delta =
          Number.isFinite(ref?.[key]) &&
          Number.isFinite(cand?.[key]) &&
          ref[key] > 0
            ? (cand[key] - ref[key]) / ref[key]
            : null;
        return (
          <article key={key} className="metric-card" style={{ "--i": i }}>
            <span className="label">{label}</span>
            <div className="ba">
              <span className="before">
                <Reel
                  text={before}
                  go={loaded}
                  reduced={reduced}
                  delay={600 + i * 150}
                />
                {before != null && unit}
              </span>
              <span className="arrow" aria-hidden="true">
                →
              </span>
              <span className="after">
                <Reel
                  text={after}
                  go={loaded}
                  reduced={reduced}
                  delay={850 + i * 150}
                />
                {after != null && unit}
              </span>
            </div>
            {delta != null && (
              <span className={"delta" + (delta < 0 ? " down" : "")}>
                {delta < 0 ? "−" : "+"}
                {Math.abs(delta * 100).toFixed(1)}%
              </span>
            )}
          </article>
        );
      })}
    </div>
  );
  const views = {
    summary: (
      <Stage
        project={project}
        measuring={measuring}
        exp={exp}
        colors={COLORS}
        reduced={reduced}
        head={
          <div className={"rr-hero " + tone}>
            <span className="eyebrow">Verdict · sealed verifier receipt</span>
            <h1>{headline}</h1>
            {reason && <p className="reason">{reason}</p>}
            {metrics}
            <p className="scope">
              Configured workload on this machine. CPU submission time is not
              GPU usage; fewer draw calls do not automatically mean a higher
              frame rate.
            </p>
          </div>
        }
      />
    ),
    pipeline: (
      <>
        <h2>What the agents did</h2>
        <p className="lede">
          Replayed from what this run recorded, in recorded order. Hover or
          press the button to take it apart.
        </p>
        {exp ? (
          <Pipeline experiment={exp} colors={COLORS} reduced={reduced} />
        ) : (
          <p className="not-recorded">No experiment ran.</p>
        )}
      </>
    ),
    patch: (
      <>
        <h2>The change</h2>
        <PatchReveal
          diff={exp?.diff || fixture?.diff}
          patchHref={
            !fixture && project ? `/api/projects/${project.id}/patch` : null
          }
          reportHref={!fixture && run ? `/api/runs/${run.id}/report` : null}
          reduced={reduced}
        />
      </>
    ),
    scene: (
      <>
        <h2>Before and after</h2>
        <DotCollapse
          before={ref?.calls}
          after={cand?.calls}
          color={COLORS.optimizer}
          reduced={reduced}
        />
        <BeforeAfter
          runId={run?.id}
          experiment={exp}
          fixture={Boolean(fixture)}
        />
      </>
    ),
    receipt: (
      <>
        <h2>Proof</h2>
        {loaded ? (
          <Receipt
            receipt={receipt}
            error={receiptError}
            experiment={exp}
            reduced={reduced}
          />
        ) : (
          <p className="not-recorded">Loading…</p>
        )}
      </>
    ),
  };

  return (
    <div
      className={"run-results" + (reduced ? " reduced" : "")}
      role="dialog"
      aria-modal="true"
      aria-label="Run results"
    >
      <Galaxy x={0.5} y={0.4} scale={0.95} />
      <div className="grain" aria-hidden="true" />
      <header className="rr-top">
        <div>
          <span className="eyebrow">
            Run results{fixture ? " · sample run" : ""}
          </span>
          <b>{project?.name || run?.projectId}</b>
          <code>{run?.id}</code>
        </div>
        <Spotlight active={active} onPick={go} />
        <button type="button" className="ghost" onClick={onClose}>
          Back to workspace
        </button>
      </header>
      <main
        className={"rr-view rr-" + active + (dir < 0 ? " back" : "")}
        key={active}
        id={"results-" + active}
      >
        {views[active]}
      </main>
    </div>
  );
}

// A recorded sample run (?fixture=accepted|rejected|failed|noshots, or "Go to dashboard"
// in the simulation). The page labels it as a sample.
export async function loadFixture(kind) {
  const [{ default: f }, { default: diff }] = await Promise.all([
    import("./results/devFixture.json"),
    import("./results/devFixture.patch?raw"),
  ]);
  const exp = {
    id: f.experimentId,
    status: f.status,
    investigation: f.investigator.brief,
    investigatorTrace: f.investigator.tools,
    trace: f.optimizer.tools,
    riskAssessment: f.riskAssessment,
    guards: f.guards,
    reference: f.reference,
    candidate: f.candidate,
    handoffs: f.handoffs,
    diff,
  };
  let receipt = f.receipt;
  if (kind === "rejected") {
    exp.status = "rejected";
    exp.guards = {
      ...f.guards,
      pass: false,
      checks: f.guards.checks.map((c, i) =>
        i === 9 ? { ...c, visualPass: false } : c,
      ),
    };
    receipt = {
      ...f.receipt,
      verdict: {
        status: "rejected",
        reason:
          "Correctness verification did not explicitly pass. Candidate was discarded.",
      },
    };
  }
  const run = {
    id: f.runId,
    projectId: f.projectId,
    status: kind === "failed" ? "failed" : exp.status,
    experiments: kind === "failed" ? [] : [exp],
  };
  if (kind === "failed") {
    run.error = "Fixture: the build failed before any experiment ran.";
    receipt = null;
  }
  return {
    run,
    project: {
      id: f.projectId,
      name: receipt?.policy?.name || f.receipt.policy.name,
    },
    fixture: { receipt, diff: kind === "failed" ? null : diff },
  };
}
