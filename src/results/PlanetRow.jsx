import React, { useEffect, useRef, useState } from "react";

// The agents as a row of planets. The selected planet is drawn large under a
// hologram of meridians with an orbit ring and a measurement arc. Moving to
// another agent sends a small rocket along an arc to it; the selection lands
// when the rocket arrives.
const W = 1000,
  H = 250,
  CY = 120;
const xs = (n) => Array.from({ length: n }, (_, i) => (W / n) * (i + 0.5));

function Planet({ x, r, color, big, idle }) {
  const id = "pg-" + Math.round(x);
  const ring = big ? r * 1.55 : r * 1.35;
  return (
    <g
      transform={`translate(${x} ${CY})`}
      className={"planet" + (big ? " big" : "") + (idle ? " idle" : "")}
    >
      <defs>
        <radialGradient id={id} cx="35%" cy="32%" r="75%">
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.55" stopColor={color} stopOpacity="0.35" />
          <stop offset="1" stopColor={color} stopOpacity="0.85" />
        </radialGradient>
      </defs>
      {big && (
        <>
          <circle r={r * 2.05} className="halo" style={{ "--a": color }} />
          <path
            className="arc"
            d={`M ${-r * 1.85} 0 A ${r * 1.85} ${r * 1.85} 0 0 1 ${r * 1.85} 0`}
          />
          {Array.from({ length: 25 }, (_, i) => {
            const a = Math.PI + (i / 24) * Math.PI,
              l = i % 6 ? 4 : 9;
            return (
              <line
                key={i}
                className="tick"
                x1={Math.cos(a) * r * 1.85}
                y1={Math.sin(a) * r * 1.85}
                x2={Math.cos(a) * (r * 1.85 + l)}
                y2={Math.sin(a) * (r * 1.85 + l)}
              />
            );
          })}
        </>
      )}
      <ellipse
        className="orbit back"
        rx={ring}
        ry={ring * 0.28}
        transform="rotate(-14)"
      />
      <circle r={r} fill={idle ? "#eef0f3" : `url(#${id})`} className="body" />
      {(big ? [0.25, 0.55, 0.85] : [0.5]).map((k) => (
        <ellipse key={k} className="meridian" rx={r * k} ry={r} />
      ))}
      {(big ? [-0.5, 0, 0.5] : [0]).map((k) => (
        <ellipse
          key={k}
          className="meridian"
          cy={k * r}
          rx={r * Math.sqrt(1 - k * k)}
          ry={r * 0.18 * Math.sqrt(1 - k * k)}
        />
      ))}
      <path
        className="orbit"
        d={`M ${-ring} 0 A ${ring} ${ring * 0.28} 0 0 0 ${ring} 0`}
        transform="rotate(-14)"
      />
    </g>
  );
}

function Rocket({ angle }) {
  return (
    <g transform={`rotate(${angle})`} className="rocket">
      <path d="M 14 0 C 8 -6 -4 -6 -8 -4 L -8 4 C -4 6 8 6 14 0 Z" />
      <path
        className="fin"
        d="M -4 -4 L -11 -9 L -8 -3 Z M -4 4 L -11 9 L -8 3 Z"
      />
      <circle cx="4" cy="0" r="2" className="window" />
      <path className="flame" d="M -8 -2.5 L -17 0 L -8 2.5 Z" />
    </g>
  );
}

export default function PlanetRow({
  stages,
  colors,
  selected,
  target,
  onArrive,
  onPick,
  reduced,
}) {
  const x = xs(stages.length);
  const index = (id) => stages.findIndex((s) => s.id === id);
  const [flight, setFlight] = useState(null);
  const trail = useRef(null);

  useEffect(() => {
    if (!target || target === selected) return;
    if (reduced) return onArrive(target);
    const a = index(selected),
      b = index(target);
    const x0 = x[a],
      x1 = x[b],
      lift = 70 + Math.abs(b - a) * 20;
    const point = (t) => {
      const mx = (x0 + x1) / 2,
        my = CY - lift - 20;
      const u = 1 - t;
      return [
        u * u * x0 + 2 * u * t * mx + t * t * x1,
        u * u * (CY - 30) + 2 * u * t * my + t * t * (CY - 30),
      ];
    };
    const ms = 900 + Math.abs(b - a) * 250;
    let frame;
    const start = performance.now();
    const tick = (now) => {
      const raw = Math.min(1, (now - start) / ms);
      const t = raw < 0.5 ? 2 * raw * raw : 1 - (-2 * raw + 2) ** 2 / 2;
      const [px, py] = point(t);
      const [qx, qy] = point(Math.min(1, t + 0.01));
      const path = Array.from({ length: 24 }, (_, i) => point((t * i) / 23));
      setFlight({
        px,
        py,
        angle: (Math.atan2(qy - py, qx - px) * 180) / Math.PI,
        path,
        to: target,
      });
      if (raw < 1) frame = requestAnimationFrame(tick);
      else {
        setFlight(null);
        onArrive(target);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  useEffect(() => {
    const key = (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.target.closest?.("input, textarea, select, iframe")) return;
      const i = index(target || selected) + (e.key === "ArrowRight" ? 1 : -1);
      if (stages[i]) onPick(stages[i].id);
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [selected, target, stages]);

  const step = (d) => {
    const i = index(target || selected) + d;
    if (stages[i]) onPick(stages[i].id);
  };

  return (
    <div className="planet-row">
      <button
        type="button"
        className="pr-arrow"
        aria-label="Previous agent"
        onClick={() => step(-1)}
      >
        ‹
      </button>
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Agents">
        <line className="pr-axis" x1="0" x2={W} y1={CY} y2={CY} />
        {stages.map((s, i) => {
          const big = s.id === selected;
          return (
            <g
              key={s.id}
              className="pr-slot"
              onClick={() => onPick(s.id)}
              role="button"
              tabIndex={0}
              aria-pressed={big}
              aria-label={`${s.name.codename}, ${s.name.name}`}
              onKeyDown={(e) => e.key === "Enter" && onPick(s.id)}
            >
              <rect
                x={x[i] - W / stages.length / 2}
                y="0"
                width={W / stages.length}
                height={H}
                fill="transparent"
              />
              <Planet
                x={x[i]}
                r={big ? 52 : 26}
                color={colors[s.id]}
                big={big}
                idle={!s.involved}
              />
              {big && (
                <text
                  x={x[i]}
                  y={CY - 112}
                  textAnchor="middle"
                  className="pr-orbit"
                >
                  ORBIT · {String(i + 1).padStart(2, "0")} OF{" "}
                  {String(stages.length).padStart(2, "0")}
                </text>
              )}
              <path
                className="pr-mark"
                d={`M ${x[i]} ${CY + 82} l 4 4 l -4 4 l -4 -4 z`}
                style={{ "--a": colors[s.id] }}
              />
              <text
                x={x[i]}
                y={CY + 112}
                textAnchor="middle"
                className={"pr-name" + (big ? " on" : "")}
              >
                {s.name.codename.toUpperCase()}
              </text>
              <text
                x={x[i]}
                y={CY + 128}
                textAnchor="middle"
                className="pr-sub"
              >
                {s.involved ? s.name.name + " · done" : "not involved"}
              </text>
            </g>
          );
        })}
        {flight && (
          <g className="pr-flight" style={{ "--a": colors[flight.to] }}>
            <polyline
              ref={trail}
              points={flight.path.map((p) => p.join(",")).join(" ")}
            />
            <g transform={`translate(${flight.px} ${flight.py})`}>
              <Rocket angle={flight.angle} />
            </g>
          </g>
        )}
      </svg>
      <button
        type="button"
        className="pr-arrow"
        aria-label="Next agent"
        onClick={() => step(1)}
      >
        ›
      </button>
    </div>
  );
}
