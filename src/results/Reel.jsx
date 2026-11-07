import React from "react";

// Digits roll into place like a slot reel. `go` is false until data has loaded
// and the number is on screen; before that the reel rests on blank.
export default function Reel({ text, go, delay = 0, reduced }) {
  if (text == null) return <span className="reel-missing">not recorded</span>;
  return (
    <span className="reel" aria-label={text}>
      {[...text].map((ch, i) => {
        if (!/\d/.test(ch))
          return (
            <span key={i} className="reel-sep" aria-hidden="true">
              {ch}
            </span>
          );
        const d = Number(ch);
        return (
          <span key={i} className="reel-col" aria-hidden="true">
            <span
              className="reel-strip"
              style={{
                transform: `translateY(${go ? -(d + 10) : 0}em)`,
                transitionDuration: reduced ? "0s" : 900 + i * 120 + "ms",
                transitionDelay: reduced ? "0s" : delay + i * 40 + "ms",
              }}
            >
              {Array.from({ length: 20 }, (_, n) => (
                <span key={n}>{n % 10}</span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}
