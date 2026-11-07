import React, { useEffect, useRef } from "react";
import * as THREE from "three";

// A tiny glossy look without textures: diffuse + fresnel rim + a sharp highlight.
function glossy(base, rim) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uBase: { value: new THREE.Color(base) },
      uRim: { value: new THREE.Color(rim) },
    },
    vertexShader: `
      varying vec3 vN; varying vec3 vV;
      void main() {
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uBase; uniform vec3 uRim;
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec3 n = normalize(vN), v = normalize(vV);
        vec3 l = normalize(vec3(0.45, 0.8, 0.55));
        float diff = max(dot(n, l), 0.0) * 0.55 + 0.45;
        float fres = pow(1.0 - max(dot(n, v), 0.0), 2.6);
        float spec = pow(max(dot(reflect(-l, n), v), 0.0), 60.0);
        gl_FragColor = vec4(uBase * diff + uRim * fres * 0.7 + vec3(1.0) * spec * 0.9, 1.0);
      }`,
  });
}

// Teardrop with its tip up, built by revolving a profile curve.
function dropletGeometry() {
  const pts = [];
  for (let i = 0; i <= 28; i++) {
    const y = (i / 28) * 1.45;
    const r =
      y <= 0.5
        ? 0.5 * Math.sqrt(Math.max(0, 1 - Math.pow((y - 0.5) / 0.5, 2)))
        : 0.5 * Math.pow(Math.max(0, 1 - (y - 0.5) / 0.95), 1.7);
    pts.push(new THREE.Vector2(r, y - 0.5));
  }
  return new THREE.LatheGeometry(pts, 28);
}

const RINGS = [
  { radius: 2.0, tilt: [0.5, 0.0, 0.3], speed: 0.42, count: 8 },
  { radius: 2.55, tilt: [-0.7, 0.4, -0.2], speed: -0.3, count: 10 },
  { radius: 3.1, tilt: [0.15, -0.5, 0.9], speed: 0.22, count: 12 },
];

// Live 3D illustration for the hero: the little blue agents orbiting a dark,
// faceted core that stands for your code. Reacts gently to the pointer.
export default function AgentsScene() {
  const box = useRef(null),
    canvas = useRef(null);
  useEffect(() => {
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: canvas.current,
        alpha: true,
        antialias: true,
        // The rip transition copies the current frame, so it must stay readable.
        preserveDrawingBuffer: true,
      });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
    camera.position.set(0, 0.9, 11.5);
    camera.lookAt(0, 0, 0);
    const world = new THREE.Group();
    scene.add(world);

    // The core: a dark crystal with bright edges.
    const core = new THREE.Group();
    const crystal = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.95, 1),
      glossy("#0a1230", "#2a5bff"),
    );
    core.add(crystal);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.96, 1)),
      new THREE.LineBasicMaterial({
        color: 0x4f7bff,
        transparent: true,
        opacity: 0.9,
      }),
    );
    core.add(edges);
    const shell = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1.35, 1)),
      new THREE.LineBasicMaterial({
        color: 0x1f4bff,
        transparent: true,
        opacity: 0.28,
      }),
    );
    world.add(core, shell);

    // Orbit paths and the agents travelling along them.
    const bodyGeo = dropletGeometry(),
      eyeGeo = new THREE.SphereGeometry(0.1, 14, 14),
      pupilGeo = new THREE.SphereGeometry(0.052, 12, 12),
      eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff }),
      pupilMat = new THREE.MeshBasicMaterial({ color: 0x0b2a66 }),
      tints = [
        "#7fd4ff",
        "#4fb0ff",
        "#3d8bff",
        "#62c7ff",
        "#5aa2ff",
        "#8fdcff",
      ],
      materials = tints.map((t) => glossy(t, "#e8f6ff"));
    const agents = [];
    RINGS.forEach((ring, ri) => {
      const frame = new THREE.Group();
      frame.rotation.set(...ring.tilt);
      const path = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(
          Array.from({ length: 160 }, (_, i) => {
            const a = (i / 160) * Math.PI * 2;
            return new THREE.Vector3(
              Math.cos(a) * ring.radius,
              0,
              Math.sin(a) * ring.radius,
            );
          }),
        ),
        new THREE.LineBasicMaterial({
          color: 0x1f4bff,
          transparent: true,
          opacity: 0.16,
        }),
      );
      frame.add(path);
      for (let k = 0; k < ring.count; k++) {
        const agent = new THREE.Group();
        const body = new THREE.Mesh(
          bodyGeo,
          materials[(ri * 3 + k) % materials.length],
        );
        body.scale.setScalar(0.34);
        const face = new THREE.Group();
        for (const side of [-1, 1]) {
          const eye = new THREE.Mesh(eyeGeo, eyeMat);
          eye.position.set(side * 0.1, 0.02, 0.17);
          const pupil = new THREE.Mesh(pupilGeo, pupilMat);
          pupil.position.set(side * 0.1, 0.02, 0.255);
          face.add(eye, pupil);
        }
        face.scale.setScalar(0.34 * 1.6);
        agent.add(body, face);
        frame.add(agent);
        agents.push({
          agent,
          ring,
          phase: (k / ring.count) * Math.PI * 2 + ri,
          bob: Math.random() * Math.PI * 2,
        });
      }
      world.add(frame);
    });

    const aim = { x: 0, y: 0 },
      tilt = { x: 0, y: 0 };
    const point = (e) => {
      aim.x = (e.clientX / innerWidth) * 2 - 1;
      aim.y = (e.clientY / innerHeight) * 2 - 1;
    };
    addEventListener("pointermove", point);
    const resize = () => {
      if (!box.current) return;
      const w = box.current.clientWidth,
        h = box.current.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const watcher = new ResizeObserver(resize);
    watcher.observe(box.current);
    resize();

    const ahead = new THREE.Vector3(),
      here = new THREE.Vector3();
    function frameAt(seconds) {
      tilt.x += (aim.y * 0.28 - tilt.x) * 0.04;
      tilt.y += (aim.x * 0.4 - tilt.y) * 0.04;
      world.rotation.x = tilt.x + 0.18;
      world.rotation.y = seconds * 0.14 + tilt.y;
      core.rotation.y = seconds * 0.35;
      core.rotation.x = seconds * 0.18;
      shell.rotation.y = -seconds * 0.22;
      shell.rotation.z = seconds * 0.1;
      for (const a of agents) {
        const t = a.phase + seconds * a.ring.speed;
        const at = (angle) =>
          here.set(
            Math.cos(angle) * a.ring.radius,
            Math.sin(seconds * 1.4 + a.bob) * 0.09,
            Math.sin(angle) * a.ring.radius,
          );
        a.agent.position.copy(at(t));
        // Face the direction of travel.
        ahead.copy(at(t + Math.sign(a.ring.speed) * 0.12));
        a.agent.lookAt(a.agent.parent.localToWorld(ahead.clone()));
        // Little hop in time with its steps.
        a.agent.children[0].position.y =
          Math.abs(Math.sin(seconds * 5 + a.bob)) * 0.05;
      }
      renderer.render(scene, camera);
    }
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const start = performance.now();
    const loop = () => {
      frameAt((performance.now() - start) / 1000);
      raf = requestAnimationFrame(loop);
    };
    if (still) frameAt(2.4);
    else loop();
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("pointermove", point);
      watcher.disconnect();
      scene.traverse((o) => {
        o.geometry?.dispose?.();
      });
      materials.forEach((m) => m.dispose());
      renderer.dispose();
    };
  }, []);
  return (
    <div
      className="hero-art"
      ref={box}
      role="img"
      aria-label="3D illustration: small blue agents orbiting a core that stands for your code"
    >
      <canvas className="agents-canvas" ref={canvas} />
    </div>
  );
}
