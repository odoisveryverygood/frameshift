import React, { useLayoutEffect, useMemo, useRef } from "react";
import "./rip.css";

// A static copy of an element's markup, safe to place on screen next to the
// original: form state is baked in and ids, focus and interaction are removed.
export function snapshotHtml(el) {
  const clone = el.cloneNode(true);
  const from = el.querySelectorAll("textarea, input"),
    to = clone.querySelectorAll("textarea, input");
  from.forEach((field, i) => {
    if (field.tagName === "TEXTAREA") to[i].textContent = field.value;
    else if (field.type === "checkbox") {
      if (field.checked) to[i].setAttribute("checked", "");
      else to[i].removeAttribute("checked");
    } else to[i].setAttribute("value", field.value);
  });
  clone.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
  clone.querySelectorAll("[for]").forEach((n) => n.removeAttribute("for"));
  clone
    .querySelectorAll("input, textarea, button, select, a")
    .forEach((n) => n.setAttribute("tabindex", "-1"));
  clone.setAttribute("aria-hidden", "true");
  return clone.outerHTML;
}

const rand = (min, max) => min + Math.random() * (max - min);
const CRACK = 240;

function makeTiles(width, height) {
  const cols = Math.min(14, Math.max(4, Math.round(width / 110))),
    rows = Math.min(9, Math.max(4, Math.round(height / 110))),
    w = width / cols,
    h = height / rows;
  return Array.from({ length: cols * rows }, (_, i) => ({
    key: i,
    x: (i % cols) * w,
    y: Math.floor(i / cols) * h,
    w,
    h,
  }));
}

// The hero cracks into tiles that peel away from the pressed button in a wave,
// uncovering the project's code. Uses ordinary CSS 3D transforms, so it works in
// every browser (the reference effect needs HTML-in-Canvas, Chromium 157+).
export default function Rip({ html, rect, origin, code, onDone }) {
  const layer = useRef(null),
    root = useRef(null);
  const tiles = useMemo(() => makeTiles(innerWidth, innerHeight), []);
  useLayoutEffect(() => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      root.current?.classList.add("out");
      setTimeout(onDone, 380);
    };
    if (reduce) {
      const t = setTimeout(finish, 350);
      return () => clearTimeout(t);
    }
    const maxDist = Math.hypot(
      Math.max(origin.x, innerWidth - origin.x),
      Math.max(origin.y, innerHeight - origin.y),
    );
    const animations = [...layer.current.children].map((el, i) => {
      const t = tiles[i];
      const cx = t.x + t.w / 2 - origin.x,
        cy = t.y + t.h / 2 - origin.y,
        dist = Math.hypot(cx, cy),
        ux = dist ? cx / dist : rand(-1, 1),
        uy = dist ? cy / dist : rand(-1, 1),
        wait = (dist / maxDist) * 560 + rand(0, 140),
        fly = rand(820, 1150),
        total = CRACK + wait + fly,
        far = rand(280, 760),
        jx = rand(-3, 3),
        jy = rand(-3, 3);
      el.style.transformOrigin = `${rand(0, 100)}% ${rand(0, 100)}%`;
      return el.animate(
        [
          {
            offset: 0,
            transform: "translate3d(0,0,0) scale(1)",
            opacity: 1,
          },
          {
            offset: CRACK / total,
            transform: `translate3d(${jx}px,${jy}px,0) scale(0.965)`,
            opacity: 1,
          },
          {
            offset: (CRACK + wait) / total,
            transform: `translate3d(${jx}px,${jy}px,0) scale(0.965)`,
            opacity: 1,
            easing: "cubic-bezier(0.55, 0.05, 0.9, 0.4)",
          },
          {
            offset: 1,
            transform: `translate3d(${ux * far + rand(-120, 120)}px,${uy * far * 0.8 - rand(0, 160)}px,${rand(180, 620)}px) rotateX(${rand(-240, 240)}deg) rotateY(${rand(-240, 240)}deg) rotateZ(${rand(-160, 160)}deg) scale(0.7)`,
            opacity: 0,
          },
        ],
        { duration: total, fill: "forwards" },
      );
    });
    Promise.all(animations.map((a) => a.finished))
      .then(() => setTimeout(finish, 420))
      .catch(finish);
    const guard = setTimeout(finish, 4200);
    return () => clearTimeout(guard);
  }, []);
  return (
    <div className="rip" aria-hidden="true" ref={root}>
      <div className="rip-code">
        {code?.length ? (
          code.map((file) => (
            <div className="rip-file" key={file.path}>
              <b>{file.path}</b>
              <pre>{file.lines.join("\n")}</pre>
            </div>
          ))
        ) : (
          <div className="rip-file skeleton">
            {Array.from({ length: 30 }, (_, i) => (
              <i key={i} style={{ width: `${30 + ((i * 41) % 60)}%` }} />
            ))}
          </div>
        )}
      </div>
      <div className="rip-tiles" ref={layer}>
        {tiles.map((t) => (
          <div
            className="rip-tile"
            key={t.key}
            style={{ left: t.x, top: t.y, width: t.w, height: t.h }}
          >
            <div
              className="rip-clone"
              style={{
                left: rect.left - t.x,
                top: rect.top - t.y,
                width: rect.width,
                height: rect.height,
              }}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
