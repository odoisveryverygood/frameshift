import React, { useEffect, useRef } from "react";
import { useInView } from "./motion.js";

const STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

// The reference's draw calls become dots that fly together and lock into the
// candidate's count. One canvas; each dot is moved by its own spring.
export default function DotCollapse({ before, after, color, reduced }) {
  const wrap = useRef(null),
    canvas = useRef(null);
  const seen = useInView(wrap, 0.4);
  const valid = Number.isFinite(before) && Number.isFinite(after) && before > 0;
  const scale = valid
    ? STEPS.find((s) => before / s <= 360) || STEPS.at(-1)
    : 1;
  const nBefore = valid ? Math.ceil(before / scale) : 0;
  const nAfter = valid ? Math.ceil(after / scale) : 0;

  useEffect(() => {
    if (!valid) return;
    const el = canvas.current,
      ctx = el.getContext("2d");
    let frame, w, h, dpr;
    const size = () => {
      dpr = devicePixelRatio || 1;
      w = el.clientWidth;
      h = el.clientHeight;
      el.width = w * dpr;
      el.height = h * dpr;
    };
    size();
    const grid = (n, cx, cols) => {
      const gap = Math.min(14, (w * 0.42) / cols);
      const rows = Math.ceil(n / cols);
      return Array.from({ length: n }, (_, i) => [
        cx + ((i % cols) - (cols - 1) / 2) * gap,
        h / 2 + (Math.floor(i / cols) - (rows - 1) / 2) * gap,
      ]);
    };
    const cols = Math.ceil(Math.sqrt(nBefore * 1.6));
    const start = grid(nBefore, w * 0.27, cols);
    const end = grid(
      nAfter,
      w * 0.75,
      Math.max(1, Math.ceil(Math.sqrt(nAfter * 1.6))),
    );
    const dots = start.map(([x, y], i) => ({
      x,
      y,
      vx: 0,
      vy: 0,
      a: 1,
      tx:
        i < nAfter
          ? end[i][0]
          : (end[i % Math.max(1, nAfter)]?.[0] ?? w * 0.75),
      ty: i < nAfter ? end[i][1] : (end[i % Math.max(1, nAfter)]?.[1] ?? h / 2),
      keep: i < nAfter,
      delay: (i / nBefore) * 0.9,
    }));
    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      for (const d of dots) {
        ctx.globalAlpha = d.a;
        ctx.fillStyle = d.keep ? color : "#94a3b8";
        ctx.beginPath();
        ctx.arc(d.x, d.y, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    if (!seen) return draw();
    if (reduced) {
      for (const d of dots) {
        d.x = d.tx;
        d.y = d.ty;
        d.a = d.keep ? 1 : 0;
      }
      return draw();
    }
    const t0 = performance.now();
    let last = t0;
    const tick = (now) => {
      const dt = Math.min(0.032, (now - last) / 1000),
        t = (now - t0) / 1000;
      last = now;
      let moving = false;
      for (const d of dots) {
        if (t < d.delay) {
          moving = true;
          continue;
        }
        const ax = 90 * (d.tx - d.x) - 14 * d.vx,
          ay = 90 * (d.ty - d.y) - 14 * d.vy;
        d.vx += ax * dt;
        d.vy += ay * dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        // Merged dots fade as they reach their target: they lock into the candidate.
        if (!d.keep)
          d.a = Math.max(
            0,
            Math.min(1, Math.hypot(d.tx - d.x, d.ty - d.y) / 60),
          );
        if (
          Math.abs(d.vx) + Math.abs(d.vy) > 0.5 ||
          Math.hypot(d.tx - d.x, d.ty - d.y) > 0.5
        )
          moving = true;
      }
      draw();
      if (moving) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [valid, seen, reduced, nBefore, nAfter, color]);

  if (!valid)
    return (
      <p className="not-recorded">
        Draw calls were not recorded for both versions.
      </p>
    );
  return (
    <figure className="dots" ref={wrap}>
      <canvas ref={canvas} aria-hidden="true" />
      <figcaption>
        <span>
          <b>{before.toLocaleString()}</b> draw calls before
        </span>
        <span className="scale">
          1 dot = {scale.toLocaleString()} draw call{scale > 1 ? "s" : ""}{" "}
          (rounded up)
        </span>
        <span>
          <b>{after.toLocaleString()}</b> after
        </span>
      </figcaption>
    </figure>
  );
}
