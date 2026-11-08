import React, { useEffect, useRef } from "react";

// A light Milky Way behind the page: two purple and blue spiral arms of dust and
// stars around a soft core, turning very slowly. Decoration only.
const COLORS = [
  "122,82,255",
  "47,107,255",
  "236,72,153",
  "34,211,238",
  "167,139,250",
  "244,114,182",
  "20,184,166",
  "96,165,250",
];

export default function Galaxy({ x = 0.62, y = 0.55, scale = 1, paused = false }) {
  const ref = useRef(null), pauseRef = useRef(paused);
  pauseRef.current = paused;
  useEffect(() => {
    const canvas = ref.current,
      ctx = canvas.getContext("2d");
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w,
      h,
      dpr,
      frame,
      last = 0;
    // Each star: arm, distance along the arm, scatter, size, colour, alpha.
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const gauss = () => (rnd() + rnd() + rnd() - 1.5) / 1.5;
    const stars = Array.from({ length: 2600 }, () => {
      const d = Math.pow(rnd(), 0.7);
      return {
        arm: rnd() < 0.5 ? 0 : Math.PI,
        d,
        sx: gauss() * (0.05 + d * 0.11),
        sy: gauss() * (0.05 + d * 0.11),
        r: rnd() < 0.04 ? 1.6 + rnd() * 1.4 : 0.5 + rnd() * 0.9,
        c: COLORS[Math.floor(rnd() * COLORS.length)],
        a: 0.15 + rnd() * 0.55,
        tw: rnd() * Math.PI * 2,
      };
    });
    const size = () => {
      dpr = Math.min(devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    };
    size();
    addEventListener("resize", size);
    const draw = (now) => {
      frame = requestAnimationFrame(draw);
      if (pauseRef.current || now - last < 33) return;
      last = now;
      const t = reduced ? 0 : now / 1000;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const cx = w * x,
        cy = h * y,
        R = Math.max(w, h) * 0.42 * scale;
      // Nebula: soft clouds along the arms and a bright core.
      const neb = (px, py, r, c, a) => {
        const g = ctx.createRadialGradient(px, py, 0, px, py, r);
        g.addColorStop(0, `rgba(${c},${a})`);
        g.addColorStop(1, `rgba(${c},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(px - r, py - r, r * 2, r * 2);
      };
      const spin = t * 0.012;
      for (let k = 0; k < 2; k++)
        for (let i = 1; i <= 5; i++) {
          const d = i / 6,
            a = k * Math.PI + d * 5.2 + spin;
          neb(
            cx + Math.cos(a) * d * R,
            cy + Math.sin(a) * d * R * 0.42,
            R * (0.16 + d * 0.1),
            COLORS[(i * 3 + k * 2) % COLORS.length],
            0.07,
          );
        }
      neb(cx, cy, R * 0.32, "196,181,253", 0.32);
      neb(cx - R * 0.18, cy + R * 0.05, R * 0.22, "244,114,182", 0.12);
      neb(cx + R * 0.2, cy - R * 0.06, R * 0.2, "34,211,238", 0.1);
      neb(cx, cy, R * 0.1, "255,255,255", 0.9);
      for (const s of stars) {
        const a = s.arm + s.d * 5.2 + spin * (1.4 - s.d * 0.6);
        const px = cx + (Math.cos(a) * s.d + s.sx) * R;
        const py = cy + (Math.sin(a) * s.d + s.sy) * R * 0.42;
        ctx.globalAlpha = s.a * (0.75 + 0.25 * Math.sin(t * 1.3 + s.tw));
        ctx.fillStyle = `rgb(${s.c})`;
        ctx.beginPath();
        ctx.arc(px, py, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (reduced) cancelAnimationFrame(frame);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("resize", size);
    };
  }, [x, y, scale]);
  return <canvas ref={ref} className="galaxy" aria-hidden="true" />;
}
