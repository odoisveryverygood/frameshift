import React, { useEffect, useRef } from "react";
import * as THREE from "three";

// A glass model of what the warehouse project builds: one of its robots. Parts
// light up in the colour of the agent that is talking about them, and labels
// are drawn as hairlines from the text to the part. No frame, no panel: the
// model floats on the page.

const GLASS = new THREE.Color("#dfe6f2");
const EDGE = new THREE.Color("#6b7486");

function roundedSlab(w, d, h, r) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -d / 2);
  s.lineTo(w / 2 - r, -d / 2);
  s.quadraticCurveTo(w / 2, -d / 2, w / 2, -d / 2 + r);
  s.lineTo(w / 2, d / 2 - r);
  s.quadraticCurveTo(w / 2, d / 2, w / 2 - r, d / 2);
  s.lineTo(-w / 2 + r, d / 2);
  s.quadraticCurveTo(-w / 2, d / 2, -w / 2, d / 2 - r);
  s.lineTo(-w / 2, -d / 2 + r);
  s.quadraticCurveTo(-w / 2, -d / 2, -w / 2 + r, -d / 2);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: h,
    bevelEnabled: true,
    bevelSize: 0.06,
    bevelThickness: 0.06,
    bevelSegments: 3,
    curveSegments: 10,
  });
  g.rotateX(-Math.PI / 2);
  return g;
}

// Each part: name and meshes (geometry + position + rotation).
function robotParts() {
  const P = (geometry, position = [0, 0, 0], rotation = [0, 0, 0]) => ({
    geometry,
    position,
    rotation,
  });
  const capsule = (r, l) => new THREE.CapsuleGeometry(r, l, 6, 16);
  return {
    chassis: [
      P(roundedSlab(2.6, 1.8, 0.42, 0.28), [0, 0.32, 0]),
      P(new THREE.BoxGeometry(2.2, 0.06, 1.5), [0, 0.86, 0]),
    ],
    wheels: [-1, 1].flatMap((x) =>
      [-1, 1].map((z) =>
        P(
          new THREE.CylinderGeometry(0.3, 0.3, 0.2, 28),
          [x * 0.95, 0.3, z * 0.95],
          [Math.PI / 2, 0, 0],
        ),
      ),
    ),
    lift: [
      P(new THREE.CylinderGeometry(0.62, 0.62, 0.1, 40), [-0.55, 1.12, 0]),
      ...[0, 1, 2].map((i) =>
        P(new THREE.CylinderGeometry(0.05, 0.05, 0.26, 10), [
          -0.55 + Math.cos((i * 2 * Math.PI) / 3) * 0.4,
          0.97,
          Math.sin((i * 2 * Math.PI) / 3) * 0.4,
        ]),
      ),
    ],
    arm: [
      P(new THREE.CylinderGeometry(0.26, 0.32, 0.22, 28), [0.7, 0.98, 0]),
      P(capsule(0.12, 0.9), [0.7, 1.55, 0], [0, 0, -0.35]),
      P(new THREE.SphereGeometry(0.17, 24, 16), [0.88, 2.06, 0]),
      P(capsule(0.1, 0.75), [0.55, 2.3, 0], [0, 0, 1.05]),
      P(capsule(0.04, 0.22), [0.18, 2.42, 0.08], [0.3, 0, 0.4]),
      P(capsule(0.04, 0.22), [0.18, 2.42, -0.08], [-0.3, 0, 0.4]),
    ],
    sensor: [
      P(new THREE.CylinderGeometry(0.05, 0.05, 0.75, 10), [-1.05, 1.25, 0.6]),
      P(
        new THREE.SphereGeometry(0.2, 28, 18, 0, Math.PI * 2, 0, Math.PI / 2),
        [-1.05, 1.62, 0.6],
      ),
      P(
        new THREE.TorusGeometry(0.24, 0.015, 8, 40),
        [-1.05, 1.63, 0.6],
        [Math.PI / 2, 0, 0],
      ),
    ],
  };
}

export default function Model3D({
  color,
  focus = [],
  callouts = [],
  tint = {},
  reduced,
  replayKey,
}) {
  const host = useRef(null);
  const labels = useRef([]);
  const lines = useRef([]);
  const dots = useRef([]);
  const live = useRef({});
  live.current = { color, focus, callouts, tint, reduced };

  useEffect(() => {
    const el = host.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    el.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    scene.add(new THREE.HemisphereLight("#ffffff", "#c9d2e3", 1.6));
    const key = new THREE.DirectionalLight("#ffffff", 1.4);
    key.position.set(3, 6, 4);
    scene.add(key);

    const root = new THREE.Group();
    scene.add(root);
    const disposables = [];
    const parts = {};
    Object.entries(robotParts()).forEach(([name, list], pi) => {
      const group = new THREE.Group();
      const material = new THREE.MeshStandardMaterial({
        color: GLASS.clone(),
        transparent: true,
        opacity: 0.2,
        roughness: 0.15,
        metalness: 0.1,
        depthWrite: false,
        emissive: new THREE.Color(0),
        side: THREE.DoubleSide,
      });
      const edgeMat = new THREE.LineBasicMaterial({
        color: EDGE.clone(),
        transparent: true,
        opacity: 0.55,
      });
      disposables.push(material, edgeMat);
      for (const p of list) {
        const mesh = new THREE.Mesh(p.geometry, material);
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(p.geometry, 28),
          edgeMat,
        );
        for (const o of [mesh, edges]) {
          o.position.set(...p.position);
          o.rotation.set(...p.rotation);
          group.add(o);
        }
        disposables.push(p.geometry, edges.geometry);
      }
      // Parts start apart and assemble on arrival.
      const dir = new THREE.Vector3(
        Math.cos(pi * 1.7) * 2.4,
        1.8 + pi * 0.4,
        Math.sin(pi * 1.7) * 2.4,
      );
      group.userData = {
        material,
        edgeMat,
        from: dir,
        delay: pi * 0.12,
        glow: 0,
      };
      root.add(group);
      parts[name] = group;
    });
    root.position.y = -1.15;

    // Holographic pad under the model and a scan ring that sweeps up through it.
    const pad = new THREE.Group();
    [1.6, 2.1, 2.6].forEach((r, i) => {
      const g = new THREE.RingGeometry(r, r + (i ? 0.006 : 0.012), 128);
      const m = new THREE.MeshBasicMaterial({
        color: EDGE.clone(),
        transparent: true,
        opacity: 0.25 - i * 0.06,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(g, m);
      ring.rotation.x = -Math.PI / 2;
      pad.add(ring);
      disposables.push(g, m);
    });
    pad.position.y = -1.14;
    scene.add(pad);
    const scanGeo = new THREE.RingGeometry(1.72, 1.8, 128);
    const scanMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const scan = new THREE.Mesh(scanGeo, scanMat);
    scan.rotation.x = -Math.PI / 2;
    scene.add(scan);
    disposables.push(scanGeo, scanMat);

    let w = 0,
      h = 0;
    const resize = () => {
      w = el.clientWidth;
      h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.position.set(0, 1.9, w / h < 0.9 ? 10.5 : 8.2);
      camera.lookAt(0, 0.2, 0);
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    let drag = null,
      spin = 0,
      spinV = 0;
    const down = (e) => (drag = e.clientX);
    const move = (e) => {
      if (drag == null) return;
      spinV = (e.clientX - drag) * 0.006;
      spin += spinV;
      drag = e.clientX;
    };
    const up = () => (drag = null);
    el.addEventListener("pointerdown", down);
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);

    const start = performance.now();
    let scanStart = start,
      lastColor = color,
      frame;
    const target = new THREE.Color(),
      tmp = new THREE.Vector3(),
      box = new THREE.Box3();
    const tick = (now) => {
      const { color, focus, callouts, tint, reduced } = live.current;
      const t = (now - start) / 1000;
      if (color !== lastColor) ((lastColor = color), (scanStart = now));
      target.set(color);
      if (drag == null) spin += spinV *= 0.94;
      root.rotation.y = -0.6 + spin + (reduced ? 0 : Math.sin(t * 0.25) * 0.3);
      pad.rotation.y = root.rotation.y;

      for (const [name, g] of Object.entries(parts)) {
        const u = g.userData;
        const k = reduced
          ? 1
          : Math.min(1, Math.max(0, (t - 0.2 - u.delay) / 1.1));
        const e = 1 - Math.pow(1 - k, 3);
        g.position.copy(u.from).multiplyScalar(1 - e);
        g.rotation.z = (1 - e) * 0.8;
        const on = focus.includes(name) ? 1 : tint[name] ? 0.6 : 0;
        u.glow += (on - u.glow) * 0.08;
        const c =
          tint[name] && !focus.includes(name)
            ? new THREE.Color(tint[name])
            : target;
        u.material.color.copy(GLASS).lerp(c, u.glow * 0.85);
        u.material.emissive.copy(c).multiplyScalar(u.glow * 0.35);
        u.material.opacity = 0.16 + u.glow * 0.42;
        u.edgeMat.color.copy(EDGE).lerp(c, u.glow);
        u.edgeMat.opacity = 0.45 + u.glow * 0.55;
      }

      // The scan ring passes up the model each time the speaking agent changes.
      const s = reduced ? 1 : Math.min(1, (now - scanStart) / 1800);
      scan.position.y = -1.1 + s * 3.8;
      scanMat.color.copy(target);
      scanMat.opacity = reduced ? 0 : Math.sin(s * Math.PI) * 0.6;

      renderer.render(scene, camera);

      // Labels: fixed spots at the sides, hairline elbows to each part.
      callouts.forEach((c, i) => {
        const part = parts[c.part],
          label = labels.current[i],
          line = lines.current[i],
          dot = dots.current[i];
        if (!part || !label || !line || !dot) return;
        box.setFromObject(part).getCenter(tmp).project(camera);
        const ax = (tmp.x * 0.5 + 0.5) * w,
          ay = (-tmp.y * 0.5 + 0.5) * h;
        const r = label.getBoundingClientRect(),
          hr = el.getBoundingClientRect();
        const right = label.dataset.side === "right";
        const lx = (right ? r.left : r.right) - hr.left,
          ly = r.top - hr.top + 10;
        const ex = right ? lx - 24 : lx + 24;
        line.setAttribute("points", `${lx},${ly} ${ex},${ly} ${ax},${ay}`);
        dot.setAttribute("cx", ax);
        dot.setAttribute("cy", ay);
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      el.removeEventListener("pointerdown", down);
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [replayKey]);

  const sides = ["left", "right", "left", "right"];
  return (
    <div className="model3d" ref={host}>
      <svg className="m-lines" aria-hidden="true">
        {callouts.map((c, i) => (
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
      {callouts.map((c, i) => (
        <div
          key={i + c.title}
          ref={(n) => (labels.current[i] = n)}
          data-side={sides[i]}
          className={`m-label m-${sides[i]} m-${i}` + (c.warn ? " warn" : "")}
          style={{ "--d": 0.3 + i * 0.2 + "s" }}
        >
          <b>{c.title}</b>
          <span>{c.text}</span>
        </div>
      ))}
    </div>
  );
}
