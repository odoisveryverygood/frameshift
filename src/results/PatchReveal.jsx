import React, { useMemo, useRef, useState } from "react";
import { useInView } from "./motion.js";

const ANIMATED = 80; // longer diffs show the rest at once

export function diffStats(diff) {
  let add = 0,
    del = 0;
  for (const line of (diff || "").split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) add++;
    else if (line.startsWith("-")) del++;
  }
  return { add, del };
}

// The recorded diff written in like a live edit: removed lines are struck through
// in red, added lines are typed in green, then the +N −M card lands.
export default function PatchReveal({ diff, patchHref, reportHref, reduced }) {
  const ref = useRef(null);
  const seen = useInView(ref, 0.15);
  const [all, setAll] = useState(false);
  const lines = useMemo(
    () => (diff || "").replace(/\n$/, "").split("\n"),
    [diff],
  );
  const { add, del } = diffStats(diff);
  if (!diff)
    return (
      <p className="not-recorded">
        No source change was recorded for this run.
      </p>
    );
  const shown = all ? lines : lines.slice(0, 160);
  let changed = 0;
  return (
    <div
      className={
        "patch" +
        (seen ? " go" : "") +
        (reduced ? " reduced" : "") +
        (all ? " expanded" : "")
      }
      ref={ref}
    >
      <pre className="patch-body">
        {shown.map((line, i) => {
          const kind =
            line.startsWith("+++") || line.startsWith("---")
              ? "file"
              : line.startsWith("@@")
                ? "hunk"
                : line[0] === "+"
                  ? "add"
                  : line[0] === "-"
                    ? "del"
                    : "ctx";
          const animated =
            (kind === "add" || kind === "del") && changed++ < ANIMATED;
          return (
            <span
              key={i}
              className={"pl " + kind + (animated ? " anim" : "")}
              style={
                animated
                  ? {
                      "--d": changed * 40 + "ms",
                      "--n": Math.max(1, line.length),
                    }
                  : undefined
              }
            >
              <span className="pl-text">{line || " "}</span>
            </span>
          );
        })}
      </pre>
      {lines.length > shown.length && (
        <button type="button" className="ghost" onClick={() => setAll(true)}>
          Show all {lines.length.toLocaleString()} lines
        </button>
      )}
      <div
        className="edit-card"
        style={{ "--d": Math.min(changed, ANIMATED) * 40 + 300 + "ms" }}
      >
        <span className="plus">+{add}</span>
        <span className="minus">−{del}</span>
        <span>lines in this run's change</span>
      </div>
      <div className="button-row">
        <button type="button" className="ghost" onClick={() => setAll(true)}>
          Review source changes
        </button>
        {patchHref && (
          <a className="ghost" href={patchHref} download>
            Export patch
          </a>
        )}
        {reportHref && (
          <a className="ghost" href={reportHref} download>
            Download run report
          </a>
        )}
      </div>
    </div>
  );
}
