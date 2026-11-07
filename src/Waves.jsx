import React, { useEffect, useRef } from "react";

// Calm ripples: soft glowing blue rings spreading slowly across water seen in
// perspective, with a few sparkles. Decoration only; it stays below the galaxy.
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
    let seed = 3;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const sparks = Array.from({ length: 90 }, () => ({
      a: rnd() * Math.PI * 2,
      r: rnd(),
      tw: rnd() * 6,
    }));
    const size = () => {
      dpr = Math.min(devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    };
    size();
    addEventListener("resize", size);
    const RINGS = 9,
      PERIOD = 26; // seconds for a ring to travel out
    const draw = (now) => {
      frame = requestAnimationFrame(draw);
      if (now - last < 33) return;
      last = now;
      const t = reduced ? 6 : now / 1000;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const cx = w * 0.42,
        cy = h * 1.15,
        maxR = w * 0.95;
      ctx.lineCap = "round";
      for (let i = 0; i < RINGS; i++) {
        const k = (t / PERIOD + i / RINGS) % 1;
        const r = 40 + k * maxR;
        const fade = Math.sin(k * Math.PI);
        // Each ring wobbles gently so it reads as water, not a circle.
        ctx.beginPath();
        for (let s = 0; s <= 120; s++) {
          const a = Math.PI + (s / 120) * Math.PI;
          const wob =
            1 +
            Math.sin(a * 5 + t * 0.4 + i) * 0.015 +
            Math.sin(a * 11 - t * 0.3) * 0.008;
          const x = cx + Math.cos(a) * r * wob,
            y = cy + Math.sin(a) * r * wob * 0.32;
          s ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        for (const [width, blur, alpha] of [
          [10, 18, 0.12],
          [3, 6, 0.3],
          [1.2, 0, 0.5],
        ]) {
          ctx.lineWidth = width;
          ctx.shadowBlur = blur;
          ctx.shadowColor = "rgba(47,107,255,0.9)";
          ctx.strokeStyle = `rgba(${i % 3 ? "47,107,255" : "122,82,255"},${alpha * fade})`;
          ctx.stroke();
        }
      }
      ctx.shadowBlur = 0;
      for (const p of sparks) {
        const r = 60 + p.r * maxR * 0.9;
        const x = cx + Math.cos(Math.PI + (p.a % Math.PI)) * r,
          y = cy + Math.sin(Math.PI + (p.a % Math.PI)) * r * 0.32;
        ctx.globalAlpha = 0.25 + 0.35 * Math.sin(t * 1.5 + p.tw) ** 2;
        ctx.fillStyle = p.tw > 3 ? "#7a52ff" : "#2f6bff";
        ctx.fillRect(x, y, 1.6, 1.6);
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
