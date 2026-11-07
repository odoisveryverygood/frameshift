import React, { useEffect, useRef, useState } from "react";
import geometry from "./engineGeometry.json";
import { registerEngine } from "./engineBus.js";

// The Raptor 2 test-stand drawing from wheresryan22/anatomy (MIT), left as a plain
// sketch on the page. It sways a little; hovering lifts pieces of it the way the rest of
// the page does. Tap the engine: a flame starts, the nozzle glows orange, and the paper
// squares around the test pad curl, glow and burn away to a black pit.

const SRC = "/engine/raptor.png";
const CELLS_X = 26; // paper squares that can burn
const LIFT_COLS = 6; // pieces that lift under the cursor
const BURN_SECONDS = 9;
const EXIT = geometry.exit; // centre of the nozzle exit
const EXIT_HALF = geometry.exitHalf; // half-width of the nozzle exit
const PAD = geometry.pad; // the test pad the flame lands on
const HOLE = geometry.hole; // half-size of the melt area (of width, of height)
const ENGINE = geometry.engine; // tap area: x0, y0, x1, y1
// The part that glows orange when it fires: the lower chamber and the bell (fractions).
const HEAT = {
  top: 0.37,
  bottom: 0.605,
  topX: [0.35, 0.65],
  bottomX: [0.325, 0.675],
};
// The part that lifts off: the engine below the stand's top beam (fractions).
const ROCKET = [0.255, 0.095, 0.745, 0.618];
const IGNITION = 0.32; // seconds the engine fires in the stand before it moves
const FLIGHT = 1.75; // seconds until it has left the screen

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
const layer = (w, h) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};

export default function EngineScene() {
  const box = useRef(null),
    card = useRef(null),
    canvas = useRef(null),
    fire = useRef(() => {});
  const [firing, setFiring] = useState(false);
  useEffect(() => {
    const ctx = canvas.current.getContext("2d");
    const source = new Image();
    // Everything is drawn into `scene`, then copied to the visible canvas.
    let scene = null, // the finished picture
      stand = null, // the stand with the engine gone
      rocket = null, // the engine on its own, for the flight
      rocketHot = null,
      sg = null,
      paper = null, // the sketch itself
      heat = null, // the orange glow, shaped to the nozzle and masked to the sketch
      pit = null, // black squares, masked to the sketch
      pg = null,
      tile = null, // one square, tinted while it burns
      tg = null,
      W = 0,
      H = 0,
      dpr = 1,
      cw = 0,
      ch = 0,
      hw = 0,
      hh = 0,
      scale = 1,
      cells = [];
    const build = () => {
      if (!source.complete || !source.naturalWidth || !W) return;
      scene = layer(W, H);
      sg = scene.getContext("2d");
      paper = layer(W, H);
      const pc = paper.getContext("2d");
      pc.drawImage(source, 0, 0, W, H);
      const rx = ROCKET[0] * W,
        ry = ROCKET[1] * H,
        rw = (ROCKET[2] - ROCKET[0]) * W,
        rh = (ROCKET[3] - ROCKET[1]) * H;
      stand = layer(W, H);
      const stc = stand.getContext("2d");
      stc.drawImage(paper, 0, 0);
      stc.clearRect(rx, ry, rw, rh);
      rocket = layer(Math.ceil(rw), Math.ceil(rh));
      rocket.getContext("2d").drawImage(paper, rx, ry, rw, rh, 0, 0, rw, rh);
      // The glow: a trapezoid over the lower engine, brighter toward the nozzle exit.
      heat = layer(W, H);
      const hc = heat.getContext("2d");
      const y0 = HEAT.top * H,
        y1 = HEAT.bottom * H;
      const grad = hc.createLinearGradient(0, y0, 0, y1);
      [
        [0, "rgba(255,150,60,0)"],
        [0.3, "rgba(255,138,48,0.55)"],
        [0.65, "rgba(255,110,28,0.92)"],
        [1, "rgba(255,168,60,1)"],
      ].forEach(([t, c]) => grad.addColorStop(t, c));
      hc.fillStyle = grad;
      hc.beginPath();
      hc.moveTo(HEAT.topX[0] * W, y0);
      hc.lineTo(HEAT.topX[1] * W, y0);
      hc.lineTo(HEAT.bottomX[1] * W, y1 + 8 * dpr);
      hc.lineTo(HEAT.bottomX[0] * W, y1 + 8 * dpr);
      hc.closePath();
      hc.fill();
      hc.globalCompositeOperation = "destination-in";
      hc.drawImage(paper, 0, 0);
      rocketHot = layer(rocket.width, rocket.height);
      const rhc = rocketHot.getContext("2d");
      rhc.drawImage(rocket, 0, 0);
      rhc.globalCompositeOperation = "multiply";
      rhc.drawImage(heat, rx, ry, rw, rh, 0, 0, rw, rh);
      rhc.globalCompositeOperation = "destination-in";
      rhc.drawImage(rocket, 0, 0);
      pit = layer(W, H);
      pg = pit.getContext("2d");
      cw = W / CELLS_X;
      const rows = Math.round(H / cw);
      ch = H / rows;
      tile = layer(Math.ceil(cw) + 2, Math.ceil(ch) + 2);
      tg = tile.getContext("2d");
      hw = W / LIFT_COLS;
      hh = H / Math.round(H / hw);
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
    const resize = () => {
      if (!box.current) return;
      const aspect = source.naturalWidth
        ? source.naturalWidth / source.naturalHeight
        : geometry.aspect;
      const bw = box.current.clientWidth,
        bh = box.current.clientHeight - 26;
      const w = Math.min(bw, bh * aspect),
        h = w / aspect;
      card.current.style.width = w + "px";
      card.current.style.height = h + "px";
      dpr = Math.min(devicePixelRatio, 2);
      W = Math.round(w * dpr);
      H = Math.round(h * dpr);
      canvas.current.width = W;
      canvas.current.height = H;
      scale = (EXIT_HALF * W) / 92;
      build();
    };
    source.onload = resize;
    source.src = SRC;
    const watcher = new ResizeObserver(resize);
    watcher.observe(box.current);
    resize();

    // ---- Burn state, flame particles and the pieces lifted by the cursor.
    const burn = { on: false, t: 0, power: 0, radius: 0 };
    // Liftoff: the engine fires in place, then a full-page overlay carries it away.
    let flight = null,
      gone = false,
      overlay = null,
      og = null;
    const trail = [];
    const dropOverlay = () => {
      overlay?.remove();
      overlay = og = null;
      trail.length = 0;
    };
    const unregister = registerEngine({
      launch: () =>
        new Promise((resolve) => {
          if (gone || flight) return resolve();
          if (still || !scene) {
            gone = true;
            return resolve();
          }
          hover = null;
          burn.on = true;
          burn.t = 0;
          burn.launch = true;
          setFiring(true);
          flight = { t: 0, resolve };
        }),
      reset: () => {
        if (flight) flight.resolve();
        flight = null;
        gone = false;
        burn.on = false;
        burn.launch = false;
        setFiring(false);
        dropOverlay();
      },
    });
    const parts = [];
    const lifts = new Map();
    let hover = null;
    const toggle = () => {
      burn.on = !burn.on;
      if (burn.on) burn.t = 0;
      setFiring(burn.on);
    };
    fire.current = toggle;
    const local = (e) => [
      (e.offsetX / canvas.current.clientWidth) * W,
      (e.offsetY / canvas.current.clientHeight) * H,
    ];
    const inEngine = (e) => {
      const x = e.offsetX / canvas.current.clientWidth,
        y = e.offsetY / canvas.current.clientHeight;
      return x > ENGINE[0] && x < ENGINE[2] && y > ENGINE[1] && y < ENGINE[3];
    };
    const tap = (e) => {
      if (inEngine(e)) toggle();
    };
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
    const move = (e) => {
      canvas.current.style.cursor = inEngine(e) ? "pointer" : "";
      if (!still && fine && e.pointerType !== "touch") hover = local(e);
    };
    const leave = () => {
      hover = null;
    };
    canvas.current.addEventListener("pointerdown", tap);
    canvas.current.addEventListener("pointermove", move);
    canvas.current.addEventListener("pointerleave", leave);
    const aim = { x: 0, y: 0 };
    const look = (e) => {
      aim.x = (e.clientX / innerWidth) * 2 - 1;
      aim.y = (e.clientY / innerHeight) * 2 - 1;
    };
    addEventListener("pointermove", look);

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
      tg.globalCompositeOperation = "source-over";
      tg.clearRect(0, 0, tile.width, tile.height);
      tg.drawImage(paper, x, y, cw, ch, 1, 1, cw, ch);
      // The colour only lands where there is paper (source-atop keeps the sketch's shape).
      tg.globalCompositeOperation = "source-atop";
      tg.fillStyle = `rgba(255,110,20,${ember * 0.85 * (1 - char * 0.5)})`;
      tg.fillRect(0, 0, tile.width, tile.height);
      tg.fillStyle = `rgba(18,12,10,${char})`;
      tg.fillRect(0, 0, tile.width, tile.height);
      tg.strokeStyle = `rgba(255,190,70,${ember * (1 - char)})`;
      tg.lineWidth = 2 * scale;
      tg.strokeRect(1, 1, cw, ch);
      sg.save();
      sg.translate(
        x + cw / 2,
        y + ch / 2 + m * m * ch * 1.3 * (0.6 + c.seed[2]),
      );
      sg.rotate(m * (1.2 + c.seed[0]) * (c.seed[1] < 0.5 ? -1 : 1));
      sg.scale(s, s * (1 - m * 0.3));
      sg.drawImage(tile, -cw / 2 - 1, -ch / 2 - 1);
      sg.restore();
    }
    function drawFlight(dt) {
      const t = flight.t - IGNITION;
      if (!overlay) {
        overlay = document.createElement("canvas");
        overlay.className = "flight-overlay";
        overlay.setAttribute("aria-hidden", "true");
        document.body.appendChild(overlay);
        og = overlay.getContext("2d");
      }
      const od = Math.min(devicePixelRatio, 2);
      if (overlay.width !== Math.round(innerWidth * od)) {
        overlay.width = Math.round(innerWidth * od);
        overlay.height = Math.round(innerHeight * od);
      }
      const r = canvas.current.getBoundingClientRect();
      const shake = t < 0.25 ? (1 - t / 0.25) * 2 : 0;
      const dy = -(760 * t * t + 70 * t);
      const rx = r.left + ROCKET[0] * r.width + rand(-shake, shake),
        ry = r.top + ROCKET[1] * r.height + dy + rand(-shake, shake),
        rw = (ROCKET[2] - ROCKET[0]) * r.width,
        rh = (ROCKET[3] - ROCKET[1]) * r.height;
      const ex = r.left + EXIT[0] * r.width,
        ey = r.top + EXIT[1] * r.height + dy,
        nozzle = EXIT_HALF * r.width;
      const padY = r.top + PAD[1] * r.height;
      // Fire and smoke are left behind in the air as the engine climbs.
      for (let n = 0; n < 14; n++)
        trail.push({
          fire: true,
          x: ex + rand(-1, 1) * nozzle * 0.55,
          y: ey + rand(0, 10),
          vx: rand(-25, 25),
          vy: rand(380, 820),
          life: 0,
          max: rand(0.45, 0.85),
          size: rand(16, 34) * (r.width / 400),
        });
      if (t < 0.7)
        for (let n = 0; n < 5; n++)
          trail.push({
            fire: false,
            x: ex + rand(-1, 1) * nozzle * 1.6,
            y: padY + rand(-6, 6),
            vx: rand(-1, 1) * 220,
            vy: rand(-40, 10),
            life: 0,
            max: rand(1.1, 1.8),
            size: rand(20, 36) * (r.width / 400),
          });
      og.setTransform(od, 0, 0, od, 0, 0);
      og.clearRect(0, 0, innerWidth, innerHeight);
      for (let n = trail.length - 1; n >= 0; n--) {
        const p = trail[n];
        p.life += dt;
        if (p.life >= p.max) {
          trail.splice(n, 1);
          continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.fire && p.y > padY - 8) {
          p.vy *= -0.15;
          p.vx = (p.x >= ex ? 1 : -1) * rand(120, 360);
          p.fire = "splash";
        }
        const k = p.life / p.max;
        let r1, g1, b1, a1, size;
        if (p.fire) {
          [r1, g1, b1, a1] = ramp(k);
          size = p.size * (1 - k * 0.4);
        } else {
          [r1, g1, b1, a1] = [196, 190, 186, 0.32 * (1 - k)];
          size = p.size * (1 + k * 2.4);
        }
        const grad = og.createRadialGradient(p.x, p.y, 0, p.x, p.y, size);
        grad.addColorStop(0, `rgba(${r1 | 0},${g1 | 0},${b1 | 0},${a1})`);
        grad.addColorStop(1, `rgba(${r1 | 0},${g1 | 0},${b1 | 0},0)`);
        og.fillStyle = grad;
        og.fillRect(p.x - size, p.y - size, size * 2, size * 2);
      }
      // A bright core right under the nozzle.
      const core = og.createRadialGradient(
        ex,
        ey + nozzle * 0.6,
        0,
        ex,
        ey + nozzle * 0.6,
        nozzle * 1.6,
      );
      core.addColorStop(0, "rgba(255,246,214,0.95)");
      core.addColorStop(0.5, "rgba(255,170,60,0.55)");
      core.addColorStop(1, "rgba(255,120,30,0)");
      og.fillStyle = core;
      og.fillRect(ex - nozzle * 1.6, ey - nozzle, nozzle * 3.2, nozzle * 3.4);
      og.drawImage(rocketHot, rx, ry, rw, rh);
      if (flight.t >= FLIGHT) {
        const done = flight.resolve;
        flight = null;
        gone = true;
        burn.launch = false;
        setFiring(false);
        dropOverlay();
        done();
      }
    }
    function frame(now) {
      // React clears the refs before it runs this effect's cleanup, so a frame can land in between.
      if (!card.current || !canvas.current) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      clock += dt;
      if (!scene) {
        raf = requestAnimationFrame(frame);
        return;
      }
      // The sketch sways in 3D, following the pointer a little.
      if (flight || gone) {
        sway[0] *= 0.6;
        sway[1] *= 0.6;
        card.current.style.transform = `perspective(1500px) rotateY(${sway[0].toFixed(3)}deg) rotateX(${sway[1].toFixed(3)}deg)`;
      } else if (!still) {
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
      burn.radius = burn.launch
        ? 0
        : burn.on
          ? lerp(
              burn.radius,
              1 - Math.pow(1 - Math.min(1, burn.t / 2.2), 3),
              Math.min(1, dt * 2.6),
            )
          : Math.max(0, burn.radius - dt * 0.7);

      const away = gone || (flight && flight.t >= IGNITION);
      if (flight) {
        flight.t += dt;
        if (flight.t >= IGNITION && burn.on) {
          // Hand the fire over to the overlay with the engine.
          burn.on = false;
          burn.power = 0;
          parts.length = 0;
        }
      }
      sg.clearRect(0, 0, W, H);
      sg.drawImage(away ? stand : paper, 0, 0);
      // The lower engine glows orange while it fires.
      if (burn.power > 0.01 && !away) {
        sg.save();
        sg.globalCompositeOperation = "multiply";
        sg.globalAlpha = clamp(
          burn.power * (0.94 + 0.06 * Math.sin(clock * 31)),
          0,
          1,
        );
        sg.drawImage(heat, 0, 0);
        sg.restore();
      }
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
            pg.globalCompositeOperation = "source-over";
            pg.clearRect(0, 0, W, H);
            pg.fillStyle = "#06070b";
          }
          pg.fillRect(c.i * cw - 0.5, c.j * ch - 0.5, cw + 1, ch + 1);
          if (m < 1) live.push([c, m]);
        }
      }
      if (holes) {
        // The pit shows only where the sketch has paper to burn through.
        pg.globalCompositeOperation = "destination-in";
        pg.drawImage(paper, 0, 0);
        sg.drawImage(pit, 0, 0);
      }
      if (burn.power > 0.02) {
        const gr = HOLE[0] * W * 1.1;
        sg.save();
        sg.translate(PAD[0] * W, padY());
        sg.scale(1, (HOLE[1] * H) / (HOLE[0] * W));
        const g = sg.createRadialGradient(0, 0, 0, 0, 0, gr);
        g.addColorStop(0, `rgba(255,150,40,${0.55 * burn.power})`);
        g.addColorStop(0.55, `rgba(255,80,20,${0.22 * burn.power})`);
        g.addColorStop(1, "rgba(255,60,20,0)");
        sg.fillStyle = g;
        sg.fillRect(-gr, -gr, gr * 2, gr * 2);
        sg.restore();
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
        sg.save();
        sg.translate(p.x, p.y);
        sg.scale(1, p.splash ? 0.4 : 1);
        const grad = sg.createRadialGradient(0, 0, 0, 0, 0, size);
        grad.addColorStop(
          0,
          `rgba(${r | 0},${g | 0},${b | 0},${a * burn.power * (p.splash ? 0.5 : 1)})`,
        );
        grad.addColorStop(1, `rgba(${r | 0},${g | 0},${b | 0},0)`);
        sg.fillStyle = grad;
        sg.fillRect(-size, -size, size * 2, size * 2);
        sg.restore();
      }
      if (burn.power > 0.02) {
        // A hot rim around the nozzle exit.
        sg.save();
        sg.strokeStyle = `rgba(255,120,30,${0.95 * burn.power})`;
        sg.lineWidth = 4 * scale;
        sg.shadowColor = "rgba(255,110,30,.9)";
        sg.shadowBlur = 14 * scale;
        sg.beginPath();
        sg.ellipse(
          exitX(),
          exitY() + 18 * scale,
          EXIT_HALF * W,
          26 * scale,
          0,
          0,
          Math.PI,
        );
        sg.stroke();
        sg.restore();
      }

      // Copy the finished picture to the screen, then lift pieces under the cursor:
      // each piece rises as a tilted white square with a dark gap beneath it.
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(scene, 0, 0);
      const reach = hw * 1.9;
      if (hover && !flight && !gone) {
        const rows = Math.round(H / hw);
        const i0 = clamp(Math.floor((hover[0] - reach) / hw), 0, LIFT_COLS - 1),
          i1 = clamp(Math.floor((hover[0] + reach) / hw), 0, LIFT_COLS - 1),
          j0 = clamp(Math.floor((hover[1] - reach) / hh), 0, rows - 1),
          j1 = clamp(Math.floor((hover[1] + reach) / hh), 0, rows - 1);
        for (let j = j0; j <= j1; j++)
          for (let i = i0; i <= i1; i++) {
            const d = Math.hypot(
              (i + 0.5) * hw - hover[0],
              (j + 0.5) * hh - hover[1],
            );
            if (d >= reach) continue;
            const key = j * LIFT_COLS + i;
            if (!lifts.has(key))
              lifts.set(key, {
                i,
                j,
                s: 0,
                t: 0,
                seed: [rand(-1, 1), rand(-1, 1), rand(-1, 1)],
              });
            lifts.get(key).t = smooth(0, 1, 1 - d / reach);
          }
      }
      lifts.forEach((c, key) => {
        if (
          !hover ||
          Math.hypot(
            (c.i + 0.5) * hw - hover[0],
            (c.j + 0.5) * hh - hover[1],
          ) >= reach
        )
          c.t = 0;
        c.s += (c.t - c.s) * Math.min(1, dt * 12);
        if (c.s < 0.01 && c.t === 0) return lifts.delete(key);
        const s = c.s,
          x = c.i * hw,
          y = c.j * hh;
        ctx.fillStyle = `rgba(5,6,10,${Math.min(1, s * 1.4)})`;
        ctx.fillRect(x - 1, y - 1, hw + 2, hh + 2);
        ctx.save();
        ctx.translate(
          x + hw / 2 + c.seed[0] * 10 * s * dpr,
          y + hh / 2 - 16 * s * dpr,
        );
        ctx.transform(
          1 - 0.04 * s,
          c.seed[1] * 0.1 * s,
          c.seed[0] * 0.1 * s,
          1 - 0.04 * s,
          0,
          0,
        );
        ctx.rotate(c.seed[2] * 0.12 * s);
        ctx.shadowColor = `rgba(10,12,20,${0.3 * s})`;
        ctx.shadowBlur = 24 * dpr * s;
        ctx.shadowOffsetY = 14 * dpr * s;
        ctx.fillStyle = "#fff";
        ctx.fillRect(-hw / 2, -hh / 2, hw, hh);
        ctx.shadowColor = "transparent";
        ctx.drawImage(scene, x, y, hw, hh, -hw / 2, -hh / 2, hw, hh);
        ctx.restore();
      });
      if (flight && flight.t >= IGNITION) drawFlight(dt);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      unregister();
      flight?.resolve();
      dropOverlay();
      removeEventListener("pointermove", look);
      watcher.disconnect();
      const c = canvas.current;
      if (c) {
        c.removeEventListener("pointerdown", tap);
        c.removeEventListener("pointermove", move);
        c.removeEventListener("pointerleave", leave);
      }
    };
  }, []);
  return (
    <div
      className="hero-art"
      ref={box}
      role="img"
      aria-label="Sketch of a rocket engine on a test stand, swaying slowly. Tap the engine to fire it."
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
