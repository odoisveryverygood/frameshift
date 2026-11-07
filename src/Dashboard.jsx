import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronRight,
  Code2,
  FileCode2,
  Gauge,
  History,
  Images,
  LayoutDashboard,
  Layers3,
  MousePointerClick,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  Diff,
  Empty,
  Evidence,
  Status,
  fmt,
  firstLine,
  runVerdict,
} from "./parts.jsx";
import "./dashboard.css";

const categories = [
  ["overview", "Overview", LayoutDashboard],
  ["performance", "Performance", Gauge],
  ["verification", "Verification", ShieldCheck],
  ["code", "Code changes", Code2],
  ["interactions", "Interactions", MousePointerClick],
  ["evidence", "Evidence", Images],
  ["history", "History", History],
];
const metrics = [
  ["Draw calls", "calls", 0, ""],
  ["CPU submit p95", "submitP95", 1, " ms"],
  ["Frame p95", "frameP95", 1, " ms"],
  ["Triangles", "triangles", 0, ""],
  ["GPU p95", "gpuP95", 2, " ms"],
];
const verdictLabel = {
  accepted: "Accepted",
  rejected: "Rejected",
  inconclusive: "Inconclusive",
  failed: "Failed",
  stopped: "Stopped",
  interrupted: "Interrupted",
  "no-attempt": "No candidate",
};

const value = (summary, key, digits, unit) =>
  !Number.isFinite(summary?.[key])
    ? "—"
    : (digits ? summary[key].toFixed(digits) : summary[key].toLocaleString()) +
      unit;
// Lower is better for every metric shown, so a negative change is an improvement.
const change = (before, after, key) =>
  Number.isFinite(before?.[key]) && Number.isFinite(after?.[key]) && before[key]
    ? (after[key] / before[key] - 1) * 100
    : null;
function useCount(target, ms = 1100) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!Number.isFinite(target)) return setShown(0);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches)
      return setShown(target);
    let frame;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / ms);
      setShown(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, ms]);
  return shown;
}
// A unified diff split into per-file chunks with line counts.
function splitDiff(text = "") {
  const files = [];
  let file = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("--- ")) {
      file = { path: "", add: 0, del: 0, lines: [line] };
      files.push(file);
    } else if (file) {
      file.lines.push(line);
      if (line.startsWith("+++ "))
        file.path = line.slice(4).replace(/^b\//, "");
      else if (line.startsWith("+")) file.add++;
      else if (line.startsWith("-")) file.del++;
    }
  }
  return files.map((f) => ({ ...f, text: f.lines.join("\n") }));
}

function Card({ title, aside, className = "", children }) {
  return (
    <section className={"dcard " + className}>
      {(title || aside) && (
        <header>
          <h3>{title}</h3>
          {aside && <span>{aside}</span>}
        </header>
      )}
      {children}
    </section>
  );
}

// 240° dial with ticks that light up to the value, as the number counts up.
function Dial({ percent, tone }) {
  const shown = useCount(
    Number.isFinite(percent) ? Math.max(0, percent) : null,
  );
  const fraction = Math.min(1, shown / 100);
  const ticks = 49,
    start = 150,
    sweep = 240;
  const point = (deg, r) => [
    100 + r * Math.cos((deg * Math.PI) / 180),
    100 + r * Math.sin((deg * Math.PI) / 180),
  ];
  const arc = (r, from, to) => {
    const [x1, y1] = point(from, r),
      [x2, y2] = point(to, r);
    return `M${x1} ${y1}A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
  };
  const shownText = !Number.isFinite(percent)
    ? "—"
    : percent < 0
      ? "−" + Math.abs(percent).toFixed(1)
      : shown.toFixed(percent >= 99.95 ? 2 : 1);
  return (
    <div className={"dial " + tone}>
      <svg
        viewBox="0 0 200 200"
        role="img"
        aria-label={`Change: ${shownText} percent`}
      >
        <path
          d={arc(88, start, start + sweep)}
          className="dial-track"
          fill="none"
          strokeLinecap="round"
        />
        {fraction > 0.002 && (
          <path
            d={arc(88, start, start + sweep * fraction)}
            className="dial-arc"
            fill="none"
            strokeLinecap="round"
          />
        )}
        {Array.from({ length: ticks }, (_, i) => {
          const deg = start + (sweep * i) / (ticks - 1),
            big = i % 6 === 0,
            [x1, y1] = point(deg, big ? 72 : 76),
            [x2, y2] = point(deg, 82);
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              className={
                "dial-tick " + (i / (ticks - 1) <= fraction ? "lit" : "")
              }
            />
          );
        })}
      </svg>
      <div className="dial-value">
        <b>
          {shownText}
          {Number.isFinite(percent) && <span>%</span>}
        </b>
      </div>
    </div>
  );
}

function Delta({ pct }) {
  if (pct == null) return <span className="delta flat">—</span>;
  const tone = Math.abs(pct) < 1 ? "flat" : pct < 0 ? "good" : "bad";
  const text =
    Math.abs(pct) < 0.05
      ? "0%"
      : (pct < 0 ? "−" : "+") +
        Math.abs(pct).toFixed(Math.abs(pct) >= 99.95 ? 2 : 1) +
        "%";
  return <span className={"delta " + tone}>{text}</span>;
}

// The insight resolves word by word, like Haelith's AI card.
function Insight({ text }) {
  const words = useMemo(
    () =>
      String(text || "")
        .split(/\s+/)
        .filter(Boolean),
    [text],
  );
  return (
    <p className="insight-text" key={text}>
      {words.map((w, i) => (
        <span key={i} style={{ animationDelay: `${Math.min(i, 60) * 28}ms` }}>
          {w}{" "}
        </span>
      ))}
    </p>
  );
}

export default function Dashboard({
  project,
  run,
  runs,
  experimentId,
  onExperiment,
  onSelectRun,
  inert,
  busy,
  provider,
  onScene,
  onCompare,
  onApply,
  onLogs,
}) {
  const [tab, setTab] = useState("overview");
  const experiments = run.experiments || [];
  const accepted = experiments.filter((e) => e.status === "accepted");
  const exp =
    experiments.find((e) => e.id === experimentId) ||
    accepted.at(-1) ||
    experiments.findLast((e) => e.guards) ||
    experiments.at(-1);
  const verdict = run.kind === "optimize" && exp ? runVerdict(run, exp) : null;
  const before = exp?.reference || run.baseline;
  const after = exp?.candidate || null;
  const targetKey = run.metric === "drawCalls" ? "calls" : "submitP95";
  const targetPct = change(before, after, targetKey);
  const improvement = targetPct == null ? null : -targetPct;
  const tone =
    improvement == null
      ? "idle"
      : improvement > 0 && verdict === "accepted"
        ? "good"
        : improvement > 0
          ? "warn"
          : "bad";
  const files = useMemo(() => splitDiff(exp?.diff), [exp?.diff]);
  const added = files.reduce((n, f) => n + f.add, 0),
    removed = files.reduce((n, f) => n + f.del, 0);
  const checks = exp?.guards?.checks || [];
  const passCount = (key, loose) =>
    checks.filter((c) => (loose ? c[key] !== false : c[key])).length;
  const maxDiff = Math.max(0, ...checks.map((c) => c.visualDifference || 0));
  const scenario = project?.config?.scenario?.events || [];
  const kinds = scenario.reduce(
    (m, e) => ({ ...m, [e.type]: (m[e.type] || 0) + 1 }),
    {},
  );
  const stamp = new Date(run.updatedAt || run.createdAt);
  const isWorkspace =
    project?.lastAcceptedRun === run.id &&
    project?.lastAcceptedExperiment === exp?.id;
  const canApply = verdict === "accepted" && isWorkspace;
  const insight =
    exp?.reason && verdict !== "accepted"
      ? exp.reason
      : exp?.hypothesis || exp?.expectedEffect || "";
  const cardProps = { before, after };
  return (
    <div className="dash" inert={inert}>
      <nav className="dash-nav" aria-label="Result categories">
        {categories.map(([id, label, Icon]) => (
          <button
            key={id}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            <Icon size={16} aria-hidden="true" />
            <span>{label}</span>
            {id === "code" && files.length > 0 && <em>{files.length}</em>}
            {id === "history" && runs.length > 1 && <em>{runs.length}</em>}
          </button>
        ))}
      </nav>
      <div className="dash-main">
        <header className="dash-top">
          <div>
            <span className="eyebrow">
              {run.kind === "optimize" ? "Improvement run" : "Baseline"} ·{" "}
              {stamp.toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
            <h1>
              {project?.name}
              {verdict && (
                <span className={"verdict " + verdict}>
                  {verdict === "accepted" ? (
                    <Check size={13} />
                  ) : (
                    <X size={13} />
                  )}
                  {verdictLabel[verdict]}
                </span>
              )}
            </h1>
          </div>
          <div className="dash-actions">
            {canApply && (
              <button className="secondary-button" onClick={onCompare}>
                <Layers3 size={14} /> Compare
              </button>
            )}
            {exp?.diff && (
              <button
                className="secondary-button"
                onClick={() => setTab("code")}
              >
                <Code2 size={14} /> View code
              </button>
            )}
            {canApply && (
              <button
                className="primary-button"
                disabled={busy}
                onClick={onApply}
              >
                Apply <ArrowRight size={14} />
              </button>
            )}
          </div>
        </header>
        {experiments.length > 1 && tab !== "history" && (
          <label className="dash-attempt">
            <span>Attempt</span>
            <select
              value={exp?.id || ""}
              onChange={(e) => onExperiment(e.target.value)}
            >
              {experiments.map((e, i) => (
                <option key={e.id} value={e.id}>
                  {i + 1}. {e.title || "Pending proposal"} — {e.status}
                </option>
              ))}
            </select>
          </label>
        )}

        {tab === "overview" && (
          <div className="grid">
            <Card
              className="span-5 gauge-card"
              title={
                targetKey === "calls" ? "Draw calls" : "CPU submission p95"
              }
              aside={
                verdict
                  ? verdict === "accepted"
                    ? "Change kept"
                    : "Candidate · not kept"
                  : "Baseline"
              }
            >
              <Dial percent={improvement} tone={tone} />
              <p className="gauge-caption">
                {improvement == null
                  ? "Run an improvement to see the change."
                  : `${value(before, targetKey, targetKey === "calls" ? 0 : 1, targetKey === "calls" ? "" : " ms")} → ${value(after, targetKey, targetKey === "calls" ? 0 : 1, targetKey === "calls" ? "" : " ms")}${improvement > 0 ? " · lower is better" : ""}`}
              </p>
            </Card>
            <Card
              className="span-7 kpis"
              title="Measured on this machine"
              aside={after ? "Before → after" : "Baseline"}
            >
              <div className="kpi-grid">
                {metrics.slice(0, 4).map(([label, key, digits, unit]) => (
                  <div className="kpi" key={key}>
                    <span>{label}</span>
                    <b>{value(after || before, key, digits, unit)}</b>
                    {after ? (
                      <small>
                        was {value(before, key, digits, unit)}{" "}
                        <Delta pct={change(before, after, key)} />
                      </small>
                    ) : (
                      <small>baseline</small>
                    )}
                  </div>
                ))}
              </div>
            </Card>
            <Card
              className="span-7"
              title="What changed"
              aside={
                exp?.status === "reasoning"
                  ? "Analyzing"
                  : exp
                    ? "Updated just now"
                    : undefined
              }
            >
              {exp ? (
                <>
                  <h4 className="insight-title">
                    {exp.title || "Analyzing source"}
                  </h4>
                  <Insight text={insight} />
                  <div className="chips">
                    {files.length > 0 && (
                      <span>
                        {files.length} file{files.length === 1 ? "" : "s"}
                      </span>
                    )}
                    {files.length > 0 && (
                      <span>
                        <i className="add">+{added}</i>{" "}
                        <i className="del">−{removed}</i>
                      </span>
                    )}
                    {exp.model && <span>{exp.model}</span>}
                    {Number.isFinite(run.tokens) && run.tokens > 0 && (
                      <span>{run.tokens.toLocaleString()} tokens</span>
                    )}
                  </div>
                </>
              ) : (
                <div className="soft-empty">
                  <p>
                    {provider?.configured
                      ? "No improvement has been run for this project yet."
                      : "Connect a model, then ask Sift to improve performance."}
                  </p>
                  <button className="secondary-button" onClick={onScene}>
                    Go to the scene <ChevronRight size={13} />
                  </button>
                </div>
              )}
            </Card>
            <Card
              className="span-5"
              title="Verification"
              aside={
                exp?.guards
                  ? exp.guards.pass
                    ? "All passed"
                    : "Failed"
                  : undefined
              }
            >
              {exp?.guards ? (
                <ul className="checklist">
                  <li
                    className={
                      passCount("visualPass") === checks.length ? "ok" : "no"
                    }
                  >
                    <span>
                      {passCount("visualPass") === checks.length ? (
                        <Check size={12} />
                      ) : (
                        <X size={12} />
                      )}
                    </span>
                    Rendered appearance
                    <em>
                      {passCount("visualPass")}/{checks.length} views
                    </em>
                  </li>
                  <li
                    className={
                      passCount("statePass") === checks.length ? "ok" : "no"
                    }
                  >
                    <span>
                      {passCount("statePass") === checks.length ? (
                        <Check size={12} />
                      ) : (
                        <X size={12} />
                      )}
                    </span>
                    Scene state
                    <em>
                      {checks[0]?.objectCount?.toLocaleString() ?? "—"} objects
                    </em>
                  </li>
                  <li
                    className={
                      passCount("pickingPass", true) === checks.length
                        ? "ok"
                        : "no"
                    }
                  >
                    <span>
                      {passCount("pickingPass", true) === checks.length ? (
                        <Check size={12} />
                      ) : (
                        <X size={12} />
                      )}
                    </span>
                    Picking
                    <em>
                      {passCount("pickingPass", true)}/{checks.length} views
                    </em>
                  </li>
                </ul>
              ) : (
                <p className="soft-note">
                  Checks run on a candidate patch. None reached this stage.
                </p>
              )}
            </Card>
            <Card
              className="span-7"
              title="Before and after"
              aside="Normalized to before = 100%"
            >
              {after ? (
                <div className="bars">
                  {metrics.slice(0, 3).map(([label, key, digits, unit]) => {
                    const pct = change(before, after, key);
                    const ratio =
                      pct == null
                        ? null
                        : Math.max(0.012, Math.min(1.4, 1 + pct / 100));
                    return (
                      <div className="bar-row" key={key}>
                        <span>{label}</span>
                        <div className="bar-pair">
                          <i className="bar before" style={{ width: "71%" }} />
                          <i
                            className="bar after"
                            style={{ width: `${(ratio ?? 0) * 71}%` }}
                          />
                        </div>
                        <small>{value(after, key, digits, unit)}</small>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="soft-note">
                  A candidate is needed to compare against the baseline.
                </p>
              )}
            </Card>
            <Card
              className="span-5"
              title="Attempts"
              aside={`${accepted.length} accepted of ${experiments.length}`}
            >
              {experiments.length ? (
                <ol className="attempts">
                  {experiments.map((e, i) => {
                    const pct = change(e.reference, e.candidate, targetKey);
                    return (
                      <li
                        key={e.id}
                        className={e.id === exp?.id ? "current" : ""}
                      >
                        <button onClick={() => onExperiment(e.id)}>
                          <span className="n">{i + 1}</span>
                          <span className="t">
                            {e.title || "Pending proposal"}
                          </span>
                          <Status value={e.status} />
                          <Delta pct={pct} />
                        </button>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="soft-note">No attempts in this run.</p>
              )}
            </Card>
          </div>
        )}

        {tab === "performance" && (
          <div className="grid">
            <Card
              className="span-12"
              title="All measurements"
              aside="Reference vs candidate, same workload"
            >
              <table className="dtable">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Before</th>
                    <th>{after ? "After" : "Candidate"}</th>
                    <th>Change</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.map(([label, key, digits, unit]) => (
                    <tr key={key}>
                      <th scope="row">{label}</th>
                      <td>{value(before, key, digits, unit)}</td>
                      <td>{value(after, key, digits, unit)}</td>
                      <td>
                        <Delta pct={change(before, after, key)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card
              className="span-7"
              title="Conditions"
              aside="Read before trusting the numbers"
            >
              <dl className="facts">
                <div>
                  <dt>Browser</dt>
                  <dd>Local headless Chrome</dd>
                </div>
                <div>
                  <dt>Viewport</dt>
                  <dd>
                    {before?.hardware?.viewport?.join(" × ") || "960 × 640"}
                  </dd>
                </div>
                <div>
                  <dt>Pixel ratio</dt>
                  <dd>{before?.hardware?.dpr || 1}</dd>
                </div>
                <div>
                  <dt>Repeated samples</dt>
                  <dd>{before?.samples || 3}</dd>
                </div>
                <div>
                  <dt>Renderer</dt>
                  <dd>{before?.renderer || "Not reported"}</dd>
                </div>
                <div>
                  <dt>Target</dt>
                  <dd>
                    {run.metric === "drawCalls"
                      ? "Draw calls, with CPU and frame guards"
                      : "CPU submission p95"}
                  </dd>
                </div>
              </dl>
            </Card>
            <Card className="span-5" title="Read this as">
              <p className="soft-note">
                CPU submission is not GPU utilization. GPU timer queries are
                reported when the browser supports them and may be noisy. One
                machine and one workload do not establish speed on other
                devices.
              </p>
              <a
                className="link-button"
                href={"/api/runs/" + run.id + "/report"}
                download
              >
                Download evidence report <ArrowDownToLine size={12} />
              </a>
            </Card>
          </div>
        )}

        {tab === "verification" && (
          <div className="grid">
            {exp?.guards ? (
              <>
                <Card
                  className="span-12"
                  title="Checks per viewpoint"
                  aside={
                    exp.guards.pass
                      ? "All configured checks passed"
                      : "A check failed"
                  }
                >
                  <table className="dtable">
                    <thead>
                      <tr>
                        <th>View</th>
                        <th>At</th>
                        <th>Visual difference</th>
                        <th>Objects</th>
                        <th>Transforms</th>
                        <th>Picking</th>
                      </tr>
                    </thead>
                    <tbody>
                      {checks.map((c, i) => (
                        <tr key={i}>
                          <th scope="row">{c.label || `View ${i + 1}`}</th>
                          <td>
                            {Number.isFinite(c.time) ? c.time + "s" : "—"}
                          </td>
                          <td>{fmt(c.visualDifference * 100, 4)}%</td>
                          <td>{c.objectCount?.toLocaleString() ?? "—"}</td>
                          <td className={c.statePass ? "ok" : "no"}>
                            {c.statePass ? "Match" : "Mismatch"}
                          </td>
                          <td className={c.pickingPass !== false ? "ok" : "no"}>
                            {c.pickingPass !== false ? "Match" : "Mismatch"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
                <Card className="span-6" title="Largest visual difference">
                  <div className="big-number">
                    {fmt(maxDiff * 100, 4)}
                    <span>%</span>
                  </div>
                  <p className="soft-note">
                    Across {checks.length} configured viewpoints.
                  </p>
                </Card>
                <Card className="span-6" title="Independent verifier">
                  {exp.verifier ? (
                    <>
                      <p className="soft-note">
                        A sealed policy, decision and evidence hashes were
                        recorded for this attempt.
                      </p>
                      <a
                        className="link-button"
                        href={`/api/runs/${run.id}/experiments/${exp.id}/verdict`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open verifier receipt <ChevronRight size={12} />
                      </a>
                    </>
                  ) : (
                    <p className="soft-note">
                      No verifier receipt was recorded for this attempt.
                    </p>
                  )}
                </Card>
                {exp.guards.errors?.length > 0 && (
                  <Card className="span-12" title="Errors during replay">
                    <ul className="errors">
                      {exp.guards.errors.slice(0, 8).map((e, i) => (
                        <li key={i}>
                          {firstLine(
                            typeof e === "string" ? e : JSON.stringify(e),
                            220,
                          )}
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}
                <p className="scope span-12">
                  Checks cover these configured states and interactions. They
                  cannot prove every possible behavior of the application.
                </p>
              </>
            ) : (
              <Card className="span-12">
                <Empty
                  title="No checks for this attempt."
                  text="Verification runs on candidate patches. This attempt did not reach it."
                />
              </Card>
            )}
          </div>
        )}

        {tab === "code" && (
          <div className="grid">
            {files.length ? (
              <>
                <Card
                  className="span-12"
                  title="Files changed"
                  aside={
                    <>
                      <i className="add">+{added}</i>{" "}
                      <i className="del">−{removed}</i>
                    </>
                  }
                >
                  <div className="file-changes">
                    {files.map((f) => (
                      <details key={f.path || f.text.slice(0, 20)}>
                        <summary>
                          <FileCode2 size={15} aria-hidden="true" />
                          <b>{f.path || "file"}</b>
                          <i className="add">+{f.add}</i>
                          <i className="del">−{f.del}</i>
                        </summary>
                        <Diff text={f.text} />
                      </details>
                    ))}
                  </div>
                </Card>
                <Card className="span-12" title="Why">
                  <h4 className="insight-title">{exp.title}</h4>
                  <Insight text={exp.hypothesis || exp.expectedEffect} />
                  {exp.notes && <p className="soft-note">{exp.notes}</p>}
                </Card>
              </>
            ) : (
              <Card className="span-12">
                <Empty
                  title="No source patch."
                  text={
                    exp?.notes ||
                    exp?.reason ||
                    "This attempt did not change any files."
                  }
                />
              </Card>
            )}
          </div>
        )}

        {tab === "interactions" && (
          <div className="grid">
            <Card className="span-5" title="Recorded actions">
              <div className="big-number">{scenario.length}</div>
              <p className="soft-note">
                {scenario.length
                  ? "Replayed on the original and the candidate; picking and state must match."
                  : "None recorded. Record clicks and keys in the scene so checks can replay them."}
              </p>
              <button className="secondary-button" onClick={onScene}>
                Open the scene <ChevronRight size={13} />
              </button>
            </Card>
            <Card className="span-7" title="By type">
              {Object.keys(kinds).length ? (
                <div className="bars">
                  {Object.entries(kinds)
                    .sort((a, b) => b[1] - a[1])
                    .map(([k, n]) => (
                      <div className="bar-row" key={k}>
                        <span>{k}</span>
                        <div className="bar-pair">
                          <i
                            className="bar after"
                            style={{
                              width: `${(n / Math.max(...Object.values(kinds))) * 100}%`,
                            }}
                          />
                        </div>
                        <small>{n}</small>
                      </div>
                    ))}
                </div>
              ) : (
                <p className="soft-note">No actions to break down.</p>
              )}
            </Card>
            <Card className="span-12" title="Replay result">
              {exp?.guards?.replay ? (
                <pre className="code-block">
                  {JSON.stringify(exp.guards.replay, null, 2)}
                </pre>
              ) : (
                <p className="soft-note">This attempt has no replay result.</p>
              )}
            </Card>
          </div>
        )}

        {tab === "evidence" && (
          <div className="grid">
            <Card
              className="span-12"
              title="Reference, candidate and difference"
            >
              <Evidence run={run} experiment={exp} onSelect={onExperiment} />
            </Card>
          </div>
        )}

        {tab === "history" && (
          <div className="grid">
            <Card
              className="span-12"
              title="Runs for this project"
              aside="Select one to review it"
            >
              <ol className="run-history">
                {runs.map((r) => (
                  <li key={r.id} className={r.id === run.id ? "current" : ""}>
                    <button
                      onClick={() => {
                        onSelectRun(r.id);
                        setTab("overview");
                      }}
                    >
                      <span className="t">
                        {r.kind === "optimize"
                          ? "Improvement"
                          : r.kind === "profile"
                            ? "Build & measure"
                            : "Verifier test"}
                      </span>
                      <Status value={r.status} />
                      <span className="m">{r.mission || r.phase}</span>
                      <time>
                        {new Date(r.createdAt).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </time>
                    </button>
                  </li>
                ))}
              </ol>
              <button className="link-button" onClick={onLogs}>
                Full log of this run <ChevronRight size={12} />
              </button>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
