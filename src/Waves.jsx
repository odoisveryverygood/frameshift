import React, { useEffect, useRef } from "react";

// Slow ripples on a dotted water plane, seen in perspective along the bottom of
// the page. Decoration only.
export default function Waves() {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current,
      ctx = canvas.getContext("2d");
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w,
      h,
      dpr,
      frame,
      last = 0;
    const size = () => {
      dpr = Math.min(devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    };
    size();
    addEventListener("resize", size);
    const COLS = 150,
      ROWS = 46;
    const draw = (now) => {
      frame = requestAnimationFrame(draw);
      if (now - last < 33) return;
      last = now;
      const t = reduced ? 0 : now / 1000;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const horizon = h * 0.52,
        cx = w / 2;
      for (let r = 0; r < ROWS; r++) {
        const z = 1 - r / ROWS; // 1 far, ~0 near
        const depth = 1 / (0.18 + z * 1.9);
        const y0 = horizon + (h - horizon) * (1 - z) * 1.05;
        for (let c = 0; c < COLS; c++) {
          const x = (c / (COLS - 1)) * 2 - 1;
          const wx = x * 6,
            wz = z * 6;
          // Rings spreading from the centre, plus a long swell.
          const d = Math.hypot(wx, wz - 2.2);
          const hgt =
            Math.sin(d * 2.4 - t * 0.9) * Math.exp(-d * 0.22) * 0.9 +
            Math.sin(wx * 0.6 + t * 0.35) * 0.25;
          const px = cx + x * w * 0.75 * depth * 0.62;
          const py = y0 - hgt * 9 * depth;
          if (px < -10 || px > w + 10) continue;
          const lift = (hgt + 1) / 2;
          ctx.globalAlpha = Math.min(
            0.75,
            (0.12 + lift * 0.5) * (1 - z * 0.75),
          );
          ctx.fillStyle = lift > 0.62 ? "#7a52ff" : "#2f6bff";
          ctx.fillRect(px, py, 1.2 + depth * 0.5, 1.2 + depth * 0.5);
        }
      }
      ctx.globalAlpha = 1;
      if (reduced) cancelAnimationFrame(frame);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("resize", size);
    };
  }, []);
  return <canvas ref={ref} className="waves" aria-hidden="true" />;
}
