import React, { useEffect, useRef, useState } from "react";
import geometry from "./engineGeometry.json";

// The Raptor 2 test-stand drawing from wheresryan22/anatomy (MIT), shown as a sheet
// of paper that sways in 3D. Tap the engine: a flame starts under the nozzle and the
// paper squares around the test pad curl, glow and burn away to a black pit.

const SRC = "/engine/raptor.png";
const CELLS_X = 26;
const BURN_SECONDS = 9;
// Positions are fractions of the drawing, measured from the artwork.
const EXIT = geometry.exit; // centre of the nozzle exit
const EXIT_HALF = geometry.exitHalf; // half-width of the nozzle exit
const PAD = geometry.pad; // the test pad the flame lands on
const HOLE = geometry.hole; // half-size of the melt area (of width, of height)
const ENGINE = geometry.engine; // tap area: x0, y0, x1, y1

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
// Flame colours over a particle's life: hot yellow, orange, red, then smoke.
const RAMP = [
  [0, 255, 238, 170, 0.95],
  [0.25, 255, 190, 70, 0.9],
  [0.55, 240, 92, 30, 0.72],
  [0.85, 150, 44, 28, 0.4],
  [1, 70, 46, 44, 0],
];
function ramp(k) {
  for (let i = 1; i < RAMP.length; i++)
    if (k <= RAMP[i][0]) {
      const a = RAMP[i - 1],
        b = RAMP[i],
        t = (k - a[0]) / (b[0] - a[0]);
      return [
        lerp(a[1], b[1], t),
        lerp(a[2], b[2], t),
        lerp(a[3], b[3], t),
        lerp(a[4], b[4], t),
      ];
    }
  return [70, 46, 44, 0];
}

export default function EngineScene() {
  const box = useRef(null),
    card = useRef(null),
    canvas = useRef(null),
    fire = useRef(() => {});
  const [firing, setFiring] = useState(false);
  useEffect(() => {
    const ctx = canvas.current.getContext("2d");
    const source = new Image();
    let paper = null, // the drawing scaled to the canvas, cut into squares when drawn
      pit = null,
      pitCtx = null,
      tileCanvas = null,
      tileCtx = null,
      W = 0,
      H = 0,
      cw = 0,
      ch = 0,
      scale = 1,
      cells = [];
    const build = () => {
      if (!source.complete || !source.naturalWidth || !W) return;
      paper = document.createElement("canvas");
      paper.width = W;
      paper.height = H;
      paper.getContext("2d").drawImage(source, 0, 0, W, H);
      cw = W / CELLS_X;
      const rows = Math.round(H / cw);
      ch = H / rows;
      pit = document.createElement("canvas");
      pit.width = W;
      pit.height = H;
      pitCtx = pit.getContext("2d");
      tileCanvas = document.createElement("canvas");
      tileCanvas.width = Math.ceil(cw) + 2;
      tileCanvas.height = Math.ceil(ch) + 2;
      tileCtx = tileCanvas.getContext("2d");
      cells = [];
      for (let j = 0; j < rows; j++)
        for (let i = 0; i < CELLS_X; i++) {
          const fx = (i + 0.5) / CELLS_X,
            fy = (j + 0.5) / rows,
            d = Math.hypot((fx - PAD[0]) / HOLE[0], (fy - PAD[1]) / HOLE[1]);
          if (d < 1.9)
            cells.push({
              i,
              j,
              d,
              noise: rand(-0.3, 0.3),
              seed: [Math.random(), Math.random(), Math.random()],
            });
        }
    };
    source.onload = () => {
      resize();
    };
    source.src = SRC;

    const resize = () => {
      if (!box.current) return;
      const aspect = source.naturalWidth
        ? source.naturalWidth / source.naturalHeight
        : 1.035;
      const bw = box.current.clientWidth,
        bh = box.current.clientHeight - 26;
      const w = Math.min(bw, bh * aspect),
        h = w / aspect;
      card.current.style.width = w + "px";
      card.current.style.height = h + "px";
      const dpr = Math.min(devicePixelRatio, 2);
      W = Math.round(w * dpr);
      H = Math.round(h * dpr);
      canvas.current.width = W;
      canvas.current.height = H;
      scale = (EXIT_HALF * W) / 92;
      build();
    };
    const watcher = new ResizeObserver(resize);
    watcher.observe(box.current);
    resize();

    // ---- Burn state and flame particles.
    const burn = { on: false, t: 0, power: 0, radius: 0 };
    const parts = [];
    const toggle = () => {
      burn.on = !burn.on;
      if (burn.on) burn.t = 0;
      setFiring(burn.on);
    };
    fire.current = toggle;
    const inEngine = (e) => {
      const x = e.offsetX / canvas.current.clientWidth,
        y = e.offsetY / canvas.current.clientHeight;
      return x > ENGINE[0] && x < ENGINE[2] && y > ENGINE[1] && y < ENGINE[3];
    };
    const tap = (e) => {
      if (inEngine(e)) toggle();
    };
    let hoverAt = 0;
    const over = (e) => {
      const now = performance.now();
      if (now - hoverAt < 50) return;
      hoverAt = now;
      canvas.current.style.cursor = inEngine(e) ? "pointer" : "";
    };
    canvas.current.addEventListener("pointerdown", tap);
    canvas.current.addEventListener("pointermove", over);
    const aim = { x: 0, y: 0 };
    const look = (e) => {
      aim.x = (e.clientX / innerWidth) * 2 - 1;
      aim.y = (e.clientY / innerHeight) * 2 - 1;
    };
    addEventListener("pointermove", look);

    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let last = performance.now(),
      clock = 0,
      sway = [0, 0],
      raf = 0;
    const exitX = () => EXIT[0] * W,
      exitY = () => EXIT[1] * H,
      padY = () => PAD[1] * H;
    function drawTile(c, m) {
      const x = c.i * cw,
        y = c.j * ch;
      const s = 1 - smooth(0.55, 1, m),
        ember = smooth(0.02, 0.35, m),
        char = smooth(0.45, 0.95, m);
      ctx.save();
      ctx.translate(
        x + cw / 2,
        y + ch / 2 + m * m * ch * 1.3 * (0.6 + c.seed[2]),
      );
      ctx.rotate(m * (1.2 + c.seed[0]) * (c.seed[1] < 0.5 ? -1 : 1));
      ctx.scale(s, s * (1 - m * 0.3));
      const t = tileCtx;
      t.globalCompositeOperation = "source-over";
      t.clearRect(0, 0, tileCanvas.width, tileCanvas.height);
      t.drawImage(paper, x, y, cw, ch, 1, 1, cw, ch);
      // The colour only lands where there is paper (source-atop keeps the drawing's shape).
      t.globalCompositeOperation = "source-atop";
      t.fillStyle = `rgba(255,110,20,${ember * 0.85 * (1 - char * 0.5)})`;
      t.fillRect(0, 0, tileCanvas.width, tileCanvas.height);
      t.fillStyle = `rgba(18,12,10,${char})`;
      t.fillRect(0, 0, tileCanvas.width, tileCanvas.height);
      t.strokeStyle = `rgba(255,190,70,${ember * (1 - char)})`;
      t.lineWidth = 2 * scale;
      t.strokeRect(1, 1, cw, ch);
      ctx.drawImage(tileCanvas, -cw / 2 - 1, -ch / 2 - 1);
      ctx.restore();
    }
    function frame(now) {
      // React clears the refs before it runs this effect\'s cleanup, so a frame can land in between.
      if (!card.current || !canvas.current) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      clock += dt;
      if (!paper) {
        raf = requestAnimationFrame(frame);
        return;
      }
      // The paper sways in 3D, following the pointer a little.
      if (!still) {
        sway[0] += (Math.sin(clock * 0.5) * 11 + aim.x * 6 - sway[0]) * 0.08;
        sway[1] += (-aim.y * 4 + Math.sin(clock * 0.37) * 2 - sway[1]) * 0.08;
        card.current.style.transform = `perspective(1500px) rotateY(${sway[0].toFixed(2)}deg) rotateX(${sway[1].toFixed(2)}deg)`;
      }
      if (burn.on) {
        burn.t += dt;
        if (burn.t > BURN_SECONDS) {
          burn.on = false;
          setFiring(false);
        }
      }
      burn.power +=
        ((burn.on ? 1 : 0) - burn.power) *
        Math.min(1, dt * (burn.on ? 3.4 : 4));
      burn.radius = burn.on
        ? lerp(
            burn.radius,
            1 - Math.pow(1 - Math.min(1, burn.t / 2.2), 3),
            Math.min(1, dt * 2.6),
          )
        : Math.max(0, burn.radius - dt * 0.7);

      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(paper, 0, 0);
      // Holes where the paper has burned, a heat glow, then the squares still curling away.
      const live = [];
      let holes = false;
      for (const c of cells) {
        const m =
          burn.radius < 0.02
            ? 0
            : clamp(
                (burn.radius * 1.12 +
                  c.noise * Math.min(1, burn.radius * 2) -
                  c.d) /
                  0.4,
                0,
                1,
              );
        if (m > 0) {
          if (!holes) {
            holes = true;
            pitCtx.globalCompositeOperation = "source-over";
            pitCtx.clearRect(0, 0, W, H);
            pitCtx.fillStyle = "#06070b";
          }
          pitCtx.fillRect(c.i * cw - 0.5, c.j * ch - 0.5, cw + 1, ch + 1);
          if (m < 1) live.push([c, m]);
        }
      }
      if (holes) {
        // The pit shows only where the drawing has paper to burn through.
        pitCtx.globalCompositeOperation = "destination-in";
        pitCtx.drawImage(paper, 0, 0);
        ctx.drawImage(pit, 0, 0);
      }
      if (burn.power > 0.02) {
        const gr = HOLE[0] * W * 1.1;
        ctx.save();
        ctx.translate(PAD[0] * W, padY());
        ctx.scale(1, (HOLE[1] * H) / (HOLE[0] * W));
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, gr);
        g.addColorStop(0, `rgba(255,150,40,${0.55 * burn.power})`);
        g.addColorStop(0.55, `rgba(255,80,20,${0.22 * burn.power})`);
        g.addColorStop(1, "rgba(255,60,20,0)");
        ctx.fillStyle = g;
        ctx.fillRect(-gr, -gr, gr * 2, gr * 2);
        ctx.restore();
      }
      live.forEach(([c, m]) => drawTile(c, m));

      // The flame: particles stream from the nozzle exit, hit the pad and spread over it.
      if (burn.power > 0.02 && !still) {
        const want = Math.round(burn.power * 9);
        for (let n = 0; n < want && parts.length < 320; n++)
          parts.push({
            x: exitX() + rand(-1, 1) * EXIT_HALF * W * 0.6,
            y: exitY() + rand(0, 8) * scale,
            vx: rand(-30, 30) * scale,
            vy: rand(560, 1150) * scale,
            life: 0,
            max: rand(0.55, 1.0),
            size: rand(20, 46) * scale,
            splash: false,
          });
      }
      const gate = padY() - 14 * scale;
      for (let n = parts.length - 1; n >= 0; n--) {
        const p = parts[n];
        p.life += dt;
        p.vx += (exitX() - p.x) * (p.splash ? 0 : 0.9) * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (!p.splash && p.y > gate) {
          p.splash = true;
          p.vx = (p.x >= exitX() ? 1 : -1) * rand(160, 520) * scale;
          p.vy = rand(-40, 30) * scale;
          p.life = Math.max(p.life, p.max * 0.35);
        }
        if (p.life >= p.max) {
          parts.splice(n, 1);
          continue;
        }
        const k = p.life / p.max,
          [r, g, b, a] = ramp(k),
          size =
            p.size * (p.splash ? 0.7 : 1 - k * 0.35) * (0.6 + 0.4 * burn.power);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.scale(1, p.splash ? 0.4 : 1);
        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, size);
        grad.addColorStop(
          0,
          `rgba(${r | 0},${g | 0},${b | 0},${a * burn.power * (p.splash ? 0.5 : 1)})`,
        );
        grad.addColorStop(1, `rgba(${r | 0},${g | 0},${b | 0},0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(-size, -size, size * 2, size * 2);
        ctx.restore();
      }
      if (burn.power > 0.02) {
        // A hot rim around the nozzle exit.
        ctx.save();
        ctx.strokeStyle = `rgba(255,120,30,${0.95 * burn.power})`;
        ctx.lineWidth = 4 * scale;
        ctx.shadowColor = "rgba(255,110,30,.9)";
        ctx.shadowBlur = 14 * scale;
        ctx.beginPath();
        ctx.ellipse(
          exitX(),
          exitY() + 18 * scale,
          EXIT_HALF * W,
          26 * scale,
          0,
          0,
          Math.PI,
        );
        ctx.stroke();
        ctx.restore();
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("pointermove", look);
      canvas.current?.removeEventListener("pointerdown", tap);
      canvas.current?.removeEventListener("pointermove", over);
      watcher.disconnect();
    };
  }, []);
  return (
    <div
      className="hero-art"
      ref={box}
      role="img"
      aria-label="Drawing of a rocket engine on a test stand, swaying slowly. Tap the engine to fire it."
    >
      <div className="engine-card" ref={card}>
        <canvas className="engine-canvas" ref={canvas} />
      </div>
      <button
        type="button"
        className="hero-art-hint"
        aria-pressed={firing}
        onClick={() => fire.current()}
      >
        {firing
          ? "Firing · tap the engine to stop"
          : "Tap the engine to fire it"}
      </button>
    </div>
  );
}
