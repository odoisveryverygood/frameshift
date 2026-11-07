import React, { useEffect, useRef } from "react";

// Slow, solid blue and violet waves rolling along the bottom of the page.
// Decoration only; it stays below the galaxy.
const LAYERS = [
  {
    amp: 18,
    len: 0.0042,
    speed: 0.22,
    base: 0.42,
    from: "rgba(96,165,250,0.35)",
    to: "rgba(167,139,250,0.30)",
  },
  {
    amp: 22,
    len: 0.0031,
    speed: -0.16,
    base: 0.55,
    from: "rgba(122,82,255,0.40)",
    to: "rgba(47,107,255,0.40)",
  },
  {
    amp: 16,
    len: 0.0052,
    speed: 0.3,
    base: 0.7,
    from: "rgba(47,107,255,0.55)",
    to: "rgba(122,82,255,0.50)",
  },
  {
    amp: 12,
    len: 0.0038,
    speed: -0.24,
    base: 0.84,
    from: "rgba(37,73,220,0.70)",
    to: "rgba(99,63,230,0.65)",
  },
];

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
    const draw = (now) => {
      frame = requestAnimationFrame(draw);
      if (now - last < 33) return;
      last = now;
      const t = reduced ? 0 : now / 1000;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      for (const L of LAYERS) {
        const g = ctx.createLinearGradient(0, 0, w, 0);
        g.addColorStop(0, L.from);
        g.addColorStop(1, L.to);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let x = 0; x <= w + 8; x += 8) {
          const y =
            h * L.base +
            Math.sin(x * L.len + t * L.speed * 2) * L.amp +
            Math.sin(x * L.len * 2.3 - t * L.speed * 1.3) * L.amp * 0.4;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();
      }
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
