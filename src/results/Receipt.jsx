import React, { useRef } from "react";
import { useInView } from "./motion.js";

// Bars generated from the real hash: each hex digit sets one bar's width.
function Barcode({ hash, go }) {
  if (!/^[0-9a-f]{16,}$/i.test(hash || "")) return null;
  let x = 0;
  const bars = [...hash.slice(0, 48)].map((ch, i) => {
    const n = parseInt(ch, 16),
      w = 1 + (n % 4),
      gap = 1 + ((n >> 2) % 3);
    const bar = { x, w, i };
    x += w + gap;
    return bar;
  });
  return (
    <svg
      className="barcode"
      viewBox={`0 0 ${x} 40`}
      preserveAspectRatio="none"
      aria-label={"Barcode of " + hash}
    >
      {bars.map((b) => (
        <rect
          key={b.i}
          x={b.x}
          width={b.w}
          y="0"
          height="40"
          style={{ "--d": b.i * 18 + "ms" }}
          className={go ? "grow" : ""}
        />
      ))}
    </svg>
  );
}

const short = (h) => (h ? h.slice(0, 12) + "…" + h.slice(-6) : "not recorded");

export default function Receipt({ receipt, error, experiment: exp, reduced }) {
  const ref = useRef(null);
  const seen = useInView(ref, 0.3);
  if (!receipt)
    return (
      <p className="not-recorded">
        {error ||
          "No sealed verifier receipt exists for this run, so there is no verdict to show."}
      </p>
    );
  const artifacts = Object.entries(receipt.artifacts || {});
  return (
    <article
      className={
        "receipt" + (seen ? " landed" : "") + (reduced ? " reduced" : "")
      }
      ref={ref}
    >
      <header>
        <span className="eyebrow">Verifier receipt</span>
        <b>{receipt.verdict?.status || "not recorded"}</b>
      </header>
      <p className="authority">{receipt.authority}</p>
      <Barcode hash={receipt.policyHash} go={seen} />
      <dl>
        <dt>Policy hash</dt>
        <dd>
          <code title={receipt.policyHash}>{short(receipt.policyHash)}</code>
        </dd>
        <dt>Evaluated</dt>
        <dd>
          {receipt.evaluatedAt
            ? new Date(receipt.evaluatedAt).toLocaleString()
            : "not recorded"}
        </dd>
        {receipt.verdict?.reason && (
          <>
            <dt>Reason</dt>
            <dd>{receipt.verdict.reason}</dd>
          </>
        )}
        <dt>Coverage</dt>
        <dd>
          {receipt.coverage?.checkpoints ?? "?"} checkpoints ·{" "}
          {receipt.coverage?.recordedEvents ?? 0} recorded events
        </dd>
      </dl>
      {artifacts.length > 0 && (
        <ul className="artifacts">
          {artifacts.map(([name, a]) => (
            <li key={name}>
              <span>{name}</span>
              <code title={a.sha256}>{short(a.sha256)}</code>
            </li>
          ))}
        </ul>
      )}
      {exp?.handoffs?.length > 0 && (
        <ul className="artifacts">
          {exp.handoffs.map((h, i) => (
            <li key={i}>
              <span>
                {h.stage} · {h.mode}
              </span>
              <time>
                {h.utc ? new Date(h.utc).toLocaleTimeString() : "not recorded"}
              </time>
            </li>
          ))}
        </ul>
      )}
      <footer>
        <p>Covers the configured workload, not every possible state.</p>
        {(receipt.coverage?.limitations || []).map((l) => (
          <p key={l}>{l}</p>
        ))}
      </footer>
      <i className="sweep" aria-hidden="true" />
    </article>
  );
}
