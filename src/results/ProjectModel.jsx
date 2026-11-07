import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";

// The project being changed, drawn from the backend's own adapter. The built
// preview is loaded out of sight and asked, through the same window.__frameshift
// contract the verifier uses, for every semantic object's world transform and the
// objects its picking probes hit. Each object becomes a point of light; the parts
// an agent is talking about glow in its colour, and labels point at real objects.

const VIEWS = [0, 1, 2];
const translation = (row) => [row[13], row[14], row[15]];

function readScene(fs, t = 0) {
  const r = fs.step(t, 0);
  return { items: r.items, picks: r.picks };
}

// Groups the model can light up, all derived from the adapter's answers.
function analyse(objects, picks, fs) {
  const n = objects.length;
  const box = new THREE.Box3();
  objects.forEach((o) => box.expandByPoint(new THREE.Vector3(...o.p)));
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(1, box.getSize(new THREE.Vector3()).length() / 2);
  const maxMotion = Math.max(1e-6, ...objects.map((o) => o.motion));
  const order = [...objects.keys()].sort(
    (a, b) => objects[b].motion - objects[a].motion,
  );
  const moving = new Set(
    order
      .slice(0, Math.max(1, Math.round(n * 0.12)))
      .filter((i) => objects[i].motion > maxMotion * 0.05),
  );
  const pickIdx = new Set(
    objects
      .map((o, i) => (picks.includes(o.id) ? i : -1))
      .filter((i) => i >= 0),
  );
  const dist = new Float32Array(n);
  objects.forEach(
    (o, i) => (dist[i] = new THREE.Vector3(...o.p).distanceTo(center) / radius),
  );
  // Anchors: probed objects for picking, the most moving for motion, and objects
  // spread across the scene for whole-scene claims, so labels never stack.
  const spread = [...objects.keys()].sort((a, b) => dist[b] - dist[a]);
  const anchor = (target, i) =>
    target === "picks" && pickIdx.size
      ? [...pickIdx][i % pickIdx.size]
      : target === "moving" && moving.size
        ? [...moving][(i * 7) % moving.size]
        : spread[Math.floor((i * 0.37 + 0.1) * n) % n];
  return {
    objects,
    picks,
    fs,
    box,
    center,
    radius,
    moving,
    pickIdx,
    dist,
    anchor,
  };
}

export default function ProjectModel({
  project,
  color,
  callouts = [],
  reduced,
  measuring,
}) {
  const host = useRef(null),
    frameRef = useRef(null);
  const labels = useRef([]),
    lines = useRef([]),
    dots = useRef([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const live = useRef({});
  live.current = { color, callouts, reduced, measuring };
  const src = project?.built ? `/preview/${project.id}/index.html` : null;

  // 1. Read the project's objects from its adapter.
  useEffect(() => {
    if (!src) return setError("This project has no build to show yet.");
    setData(null);
    setError(null);
    const iframe = frameRef.current;
    let tries = 0,
      timer;
    const poll = () => {
      const fs = iframe.contentWindow?.__frameshift;
      if (!fs?.ready) {
        if (++tries > 80)
          return setError("The build did not expose its scene adapter.");
        return (timer = setTimeout(poll, 150));
      }
      try {
        const now = readScene(fs, 0),
          later = readScene(fs, 1);
        const picks = new Set();
        for (const v of VIEWS)
          fs.step(0, v).picks.forEach((id) => id != null && picks.add(id));
        const moved = new Map(
          later.items.map((row) => [row[0], translation(row)]),
        );
        const objects = now.items.map((row) => {
          const p = translation(row),
            q = moved.get(row[0]) || p;
          return {
            id: row[0],
            p,
            motion: Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]),
          };
        });
        setData(analyse(objects, [...picks], fs));
      } catch (e) {
        setError("Could not read the scene: " + e.message);
      }
    };
    const load = () => poll();
    iframe.addEventListener("load", load);
    return () => {
      clearTimeout(timer);
      iframe.removeEventListener("load", load);
    };
  }, [src]);

  // 2. Draw it.
  useEffect(() => {
    if (!data) return;
    const el = host.current;
    const { objects, fs, center, radius, box, moving, pickIdx, dist } = data;
    const n = objects.length;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    el.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 5000);

    const pos = new Float32Array(n * 3),
      on = new Float32Array(n),
      size = new Float32Array(n);
    objects.forEach((o, i) => {
      pos.set(o.p, i * 3);
      size[i] = pickIdx.has(i) ? 2.2 : 1;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aOn", new THREE.BufferAttribute(on, 1));
    geo.setAttribute("aDist", new THREE.BufferAttribute(dist, 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    const uniforms = {
      uTime: { value: 0 },
      uStart: { value: 0 },
      uIn: { value: 0 },
      uColor: { value: new THREE.Color(color) },
      uBase: { value: new THREE.Color("#5d6688") },
      uScale: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: `
        attribute float aOn; attribute float aDist; attribute float aSize;
        uniform float uTime, uStart, uIn, uScale;
        varying float vOn; varying float vFade;
        void main() {
          float wave = clamp((uTime - uStart) * 1.6 - aDist * 1.3, 0.0, 1.0);
          vOn = aOn * wave;
          vFade = clamp(uIn * 1.8 - aDist, 0.0, 1.0);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (1.0 + vOn * 0.9) * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uColor, uBase; varying float vOn; varying float vFade;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float core = smoothstep(0.5, 0.12, d);
          float a = core * (0.45 + 0.55 * vOn) * vFade;
          if (a < 0.01) discard;
          gl_FragColor = vec4(mix(uBase, uColor, vOn), a);
        }`,
    });
    const points = new THREE.Points(geo, mat);
    points.position.copy(center).multiplyScalar(-1);
    const root = new THREE.Group();
    root.add(points);
    scene.add(root);

    // Hairline rings on the ground, like a chart under the model.
    const rings = [];
    [1.05, 1.35, 1.65].forEach((k, i) => {
      const g = new THREE.RingGeometry(
        radius * k,
        radius * k + radius * 0.004,
        160,
      );
      const m = new THREE.MeshBasicMaterial({
        color: "#7a52ff",
        transparent: true,
        opacity: 0.18 - i * 0.04,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(g, m);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = box.min.y - center.y - radius * 0.02;
      root.add(ring);
      rings.push(g, m);
    });

    let w = 0,
      h = 0;
    const resize = () => {
      w = el.clientWidth;
      h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      const d = radius * (w / h < 0.9 ? 3.6 : 2.5);
      camera.position.set(0, d * 0.62, d);
      camera.lookAt(0, -radius * 0.08, 0);
      camera.near = d / 100;
      camera.far = d * 10;
      camera.updateProjectionMatrix();
      // About 45% of the typical gap between neighbouring objects, in pixels.
      const ext = box.getSize(new THREE.Vector3());
      const spacing =
        Math.sqrt((Math.max(ext.x, 1e-3) * Math.max(ext.z, 1e-3)) / n) ||
        radius / 20;
      uniforms.uScale.value =
        (0.45 * spacing * h * renderer.getPixelRatio()) /
        (2 * Math.tan((camera.fov * Math.PI) / 360));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    let drag = null,
      spin = 0,
      spinV = 0;
    const down = (e) => (drag = e.clientX);
    const move = (e) =>
      drag != null &&
      ((spinV = (e.clientX - drag) * 0.006),
      (spin += spinV),
      (drag = e.clientX));
    const up = () => (drag = null);
    el.addEventListener("pointerdown", down);
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);

    const start = performance.now();
    let key = "",
      sim = 0,
      lastStep = 0,
      frame;
    const v = new THREE.Vector3();
    const tick = (now) => {
      frame = requestAnimationFrame(tick);
      const { color, callouts, reduced, measuring } = live.current;
      const t = (now - start) / 1000;
      uniforms.uTime.value = t;
      uniforms.uIn.value = reduced ? 2 : Math.min(2, t * 0.9);
      uniforms.uColor.value.set(color);

      // Which objects glow: the union of what the current labels point at.
      const k = color + callouts.map((c) => c.target).join();
      if (k !== key) {
        key = k;
        uniforms.uStart.value = reduced ? -10 : t;
        const all = callouts.some((c) => c.target === "all");
        for (let i = 0; i < n; i++)
          on[i] =
            all ||
            (callouts.some((c) => c.target === "picks") && pickIdx.has(i)) ||
            (callouts.some((c) => c.target === "moving") && moving.has(i))
              ? 1
              : 0;
        geo.attributes.aOn.needsUpdate = true;
      }

      // Replay the project's own motion through its adapter, a few times a second.
      // Never while a measurement is running anywhere on this machine.
      if (!reduced && !measuring && now - lastStep > 90) {
        lastStep = now;
        sim += 0.09;
        try {
          const items = fs.step(sim, 0).items;
          if (items.length === n) {
            for (let i = 0; i < n; i++) pos.set(translation(items[i]), i * 3);
            geo.attributes.position.needsUpdate = true;
          }
        } catch {}
      }
      if (drag == null) spin += spinV *= 0.94;
      root.rotation.y = spin + (reduced ? 0.4 : 0.4 + t * 0.04);
      renderer.render(scene, camera);

      // Labels: fixed at the sides, hairline elbows to a real object.
      callouts.forEach((c, i) => {
        const label = labels.current[i],
          line = lines.current[i],
          dot = dots.current[i];
        if (!label || !line || !dot || c.anchor == null) return;
        v.fromArray(pos, c.anchor * 3);
        points.localToWorld(v).project(camera);
        const ax = (v.x * 0.5 + 0.5) * w,
          ay = (-v.y * 0.5 + 0.5) * h;
        const r = label.getBoundingClientRect(),
          hr = el.getBoundingClientRect();
        const right = label.dataset.side === "right";
        const lx = (right ? r.left : r.right) - hr.left,
          ly = r.top - hr.top + 10;
        line.setAttribute(
          "points",
          `${lx},${ly} ${right ? lx - 24 : lx + 24},${ly} ${ax},${ay}`,
        );
        dot.setAttribute("cx", ax);
        dot.setAttribute("cy", ay);
      });
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      el.removeEventListener("pointerdown", down);
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      geo.dispose();
      mat.dispose();
      rings.forEach((r) => r.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [data]);

  const sides = ["left", "right", "left", "right"];
  const placed = callouts.map((c, i) => ({
    ...c,
    anchor: data?.anchor ? data.anchor(c.target, i) : null,
  }));
  live.current.callouts = placed;
  const stats = data && {
    objects: data.objects.length,
    picks: data.picks.length,
  };
  return (
    <div className="model3d project-model" ref={host}>
      {src && (
        <iframe
          ref={frameRef}
          src={src}
          title=""
          aria-hidden="true"
          tabIndex={-1}
          className="pm-source"
        />
      )}
      {error && <p className="not-recorded pm-error">{error}</p>}
      {!data && !error && (
        <p className="pm-loading">Reading {project?.name || "the project"}…</p>
      )}
      {stats && (
        <p className="pm-caption">
          {project?.name} · {stats.objects.toLocaleString()} objects ·{" "}
          {stats.picks} picked by probes · read from the build
        </p>
      )}
      <svg className="m-lines" aria-hidden="true">
        {placed.map((c, i) => (
          <g
            key={i + c.title}
            style={{ "--d": 0.35 + i * 0.2 + "s" }}
            className={c.warn ? "warn" : ""}
          >
            <polyline ref={(n) => (lines.current[i] = n)} />
            <circle r="4" ref={(n) => (dots.current[i] = n)} />
          </g>
        ))}
      </svg>
      {placed.map((c, i) => (
        <div
          key={i + c.title}
          ref={(n) => (labels.current[i] = n)}
          data-side={sides[i]}
          className={`m-label m-${sides[i]} m-${i}` + (c.warn ? " warn" : "")}
          style={{ "--d": 0.3 + i * 0.2 + "s" }}
        >
          <b>{c.title}</b>
          <span>
            {c.text}
            {c.anchor != null && data && (
              <em> · {String(data.objects[c.anchor].id)}</em>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
