import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

// A small white "factory" in 3D: the rocket lands on a pad in the middle and four
// agents, each at its own station, take turns working on it. Which agent works,
// and how, follows the run (see AgentField); the scene only animates it.

const STATIONS = {
  scout: [-3.3, -3.3],
  gauge: [3.3, -3.3],
  smith: [3.3, 3.3],
  warden: [-3.3, 3.3],
};
const PAD_TOP = 0.16;
const LAND_SECONDS = 2.1;
const AGENT_SIZE = 1.45;
const ink = new THREE.Color("#1a1d26");

const clay = (color = "#f4f3f0", rough = 0.72) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.04 });
const glow = (color, opacity = 1) =>
  new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity });
const smooth = (t) => t * t * (3 - 2 * t);
const rand = (a, b) => a + Math.random() * (b - a);

// Mesh with soft shadows and a thin ink outline, so it reads like the sketch.
function inked(geometry, material, { outline = true, threshold = 30 } = {}) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  if (outline) {
    const lines = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, threshold),
      new THREE.LineBasicMaterial({
        color: ink,
        transparent: true,
        opacity: 0.32,
      }),
    );
    g.add(lines);
    g.userData.lines = lines;
  }
  g.userData.mesh = m;
  return g;
}

function buildRocket() {
  const rocket = new THREE.Group();
  const parts = [];
  const add = (obj, outward = [0, 0, 0]) => {
    obj.userData.home = obj.position.clone();
    obj.userData.out = new THREE.Vector3(...outward);
    parts.push(obj);
    rocket.add(obj);
    return obj;
  };
  const white = clay(),
    steel = clay("#e9ebf0", 0.55);
  // Bell nozzle, throat and chamber, revolved.
  const profile = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    profile.push(
      new THREE.Vector2(0.24 + 0.56 * Math.pow(1 - t, 0.6), 1.25 * t),
    );
  }
  for (let i = 1; i <= 10; i++) {
    const y = 1.25 + (0.7 * i) / 10;
    profile.push(
      new THREE.Vector2(0.24 + 0.16 * smooth(Math.min(1, (y - 1.25) / 0.5)), y),
    );
  }
  const bell = inked(
    new THREE.LatheGeometry(profile, 56),
    new THREE.MeshStandardMaterial({
      color: "#f4f3f0",
      roughness: 0.62,
      metalness: 0.05,
      side: THREE.DoubleSide,
    }),
    { threshold: 40 },
  );
  add(bell);
  rocket.userData.bell = bell;
  for (const [y, r] of [
    [0.02, 0.81],
    [0.42, 0.62],
    [0.8, 0.45],
    [1.92, 0.42],
  ]) {
    const ring = inked(new THREE.TorusGeometry(r, 0.035, 10, 56), steel, {
      outline: false,
    });
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    add(ring);
  }
  const dome = inked(
    new THREE.SphereGeometry(0.46, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    white,
    { threshold: 50 },
  );
  dome.scale.y = 0.7;
  dome.position.y = 1.95;
  add(dome, [0, 0.35, 0]);
  const neck = inked(new THREE.CylinderGeometry(0.28, 0.32, 0.36, 32), steel);
  neck.position.y = 2.42;
  add(neck, [0, 0.55, 0]);
  const plate = inked(new THREE.CylinderGeometry(0.62, 0.62, 0.1, 40), white);
  plate.position.y = 2.66;
  add(plate, [0, 0.8, 0]);
  // Turbopumps with a volute each.
  for (const [x, z, h, r, out] of [
    [0.78, 0.15, 0.7, 0.2, [0.9, 0.2, 0.2]],
    [-0.74, -0.2, 0.82, 0.23, [-0.9, 0.25, -0.2]],
  ]) {
    const pump = new THREE.Group();
    pump.add(inked(new THREE.CylinderGeometry(r, r * 1.08, h, 28), white));
    const volute = inked(
      new THREE.TorusGeometry(r * 1.04, r * 0.32, 10, 28),
      steel,
      { outline: false },
    );
    volute.rotation.x = Math.PI / 2;
    volute.position.y = h * 0.25;
    pump.add(volute);
    const cap = inked(
      new THREE.SphereGeometry(
        r * 0.92,
        20,
        10,
        0,
        Math.PI * 2,
        0,
        Math.PI / 2,
      ),
      white,
      { outline: false },
    );
    cap.position.y = h / 2;
    pump.add(cap);
    pump.position.set(x, 1.75, z);
    add(pump, out);
  }
  // Plumbing from the pumps to the chamber.
  const tube = (pts, r) =>
    inked(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))),
        30,
        r,
        8,
      ),
      steel,
      { outline: false },
    );
  add(
    tube(
      [
        [0.78, 1.4, 0.15],
        [0.62, 1.25, 0.12],
        [0.4, 1.4, 0.06],
      ],
      0.045,
    ),
    [0.55, -0.1, 0.1],
  );
  add(
    tube(
      [
        [-0.74, 1.35, -0.2],
        [-0.55, 1.2, -0.16],
        [-0.36, 1.42, -0.06],
      ],
      0.05,
    ),
    [-0.55, -0.1, -0.1],
  );
  add(
    tube(
      [
        [0.78, 2.1, 0.15],
        [0.5, 2.35, 0.1],
        [0.2, 2.4, 0.05],
      ],
      0.035,
    ),
    [0.5, 0.4, 0.1],
  );
  add(
    tube(
      [
        [-0.74, 2.2, -0.2],
        [-0.45, 2.42, -0.1],
        [-0.2, 2.42, -0.05],
      ],
      0.035,
    ),
    [-0.5, 0.4, -0.1],
  );
  // Landing legs.
  const legs = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5,
      top = new THREE.Vector3(Math.cos(a) * 0.5, 0.75, Math.sin(a) * 0.5),
      foot = new THREE.Vector3(Math.cos(a) * 1.25, -0.62, Math.sin(a) * 1.25);
    const leg = inked(
      new THREE.CylinderGeometry(0.04, 0.05, top.distanceTo(foot), 10),
      steel,
      { outline: false },
    );
    leg.position.copy(top).add(foot).multiplyScalar(0.5);
    leg.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      foot.clone().sub(top).normalize(),
    );
    legs.add(leg);
    const pad = inked(new THREE.CylinderGeometry(0.14, 0.16, 0.05, 16), white, {
      outline: false,
    });
    pad.position.copy(foot);
    legs.add(pad);
  }
  rocket.add(legs);
  rocket.userData.parts = parts;
  return rocket;
}

function flameMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uPower: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform float uTime; uniform float uPower; varying vec2 vUv;
      float n(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
      void main(){
        float f = 1.0 - vUv.y;
        float flick = 0.85 + 0.15 * sin(uTime * 40.0 + vUv.x * 30.0) + 0.1 * n(vec2(floor(uTime*30.0), vUv.x));
        float a = smoothstep(1.0, 0.0, f) * smoothstep(0.0, 0.08, f) * uPower * flick;
        vec3 c = mix(vec3(1.0,0.93,0.65), vec3(1.0,0.45,0.1), smoothstep(0.0,0.6,f));
        c = mix(c, vec3(0.85,0.18,0.08), smoothstep(0.55,1.0,f));
        gl_FragColor = vec4(c, a * 0.9);
      }`,
  });
}

function buildAgent(id, color) {
  const g = new THREE.Group();
  const body = new THREE.Group();
  const base = clay(color, 0.45);
  const dark = clay("#14183a", 0.4);
  const eyes = (y, z, gap = 0.1) => {
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 12, 12),
        glow("#ffffff"),
      );
      e.position.set(s * gap, y, z);
      body.add(e);
      const p = new THREE.Mesh(
        new THREE.SphereGeometry(0.028, 10, 10),
        glow("#0b1a44"),
      );
      p.position.set(s * gap, y, z + 0.035);
      body.add(p);
    }
  };
  let tool = new THREE.Vector3(0, 0.35, 0.3);
  if (id === "scout") {
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const y = (i / 24) * 0.85;
      const r =
        y <= 0.3
          ? 0.3 * Math.sqrt(Math.max(0, 1 - Math.pow((y - 0.3) / 0.3, 2)))
          : 0.3 * Math.pow(Math.max(0, 1 - (y - 0.3) / 0.55), 1.6);
      pts.push(new THREE.Vector2(r, y));
    }
    body.add(inked(new THREE.LatheGeometry(pts, 32), base, { outline: false }));
    const lens = inked(
      new THREE.TorusGeometry(0.13, 0.03, 10, 28),
      clay("#dce8ff", 0.3),
      { outline: false },
    );
    lens.position.set(0, 0.3, 0.27);
    body.add(lens);
    const glass = new THREE.Mesh(
      new THREE.CircleGeometry(0.12, 24),
      glow("#9cc4ff"),
    );
    glass.position.set(0, 0.3, 0.285);
    body.add(glass);
    tool = new THREE.Vector3(0, 0.3, 0.3);
  } else if (id === "gauge") {
    body.add(
      inked(new THREE.SphereGeometry(0.32, 32, 20), base, { outline: false }),
    );
    const face = new THREE.Mesh(
      new THREE.CircleGeometry(0.21, 32),
      glow("#e9fffa"),
    );
    face.position.set(0, 0.02, 0.315);
    body.add(face);
    const needle = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.17, 0.01),
      glow("#e0602c"),
    );
    needle.geometry.translate(0, 0.08, 0);
    needle.position.set(0, 0.0, 0.33);
    body.add(needle);
    g.userData.needle = needle;
    const ant = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.18, 6),
      dark,
    );
    ant.position.y = 0.4;
    body.add(ant);
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 12, 12),
      glow("#7ff0d8"),
    );
    tip.position.y = 0.5;
    body.add(tip);
    g.userData.tip = tip;
    body.position.y = 0.32;
    eyes(0.18, 0.22, 0.12);
    tool = new THREE.Vector3(0, 0.55, 0);
  } else if (id === "smith") {
    body.add(
      inked(new RoundedBoxGeometry(0.62, 0.6, 0.56, 4, 0.12), base, {
        outline: false,
      }),
    );
    const visor = new THREE.Mesh(
      new RoundedBoxGeometry(0.46, 0.14, 0.05, 3, 0.05),
      dark,
    );
    visor.position.set(0, 0.04, 0.285);
    body.add(visor);
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(
        new THREE.BoxGeometry(0.09, 0.035, 0.02),
        glow("#bda9ff"),
      );
      e.position.set(s * 0.1, 0.04, 0.315);
      body.add(e);
    }
    const arm = new THREE.Group();
    const rod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.42, 8),
      clay("#cfd5e3", 0.4),
    );
    rod.rotation.z = Math.PI / 2;
    rod.position.x = 0.21;
    arm.add(rod);
    const head = new THREE.Mesh(
      new THREE.TorusGeometry(0.06, 0.022, 8, 16, Math.PI * 1.5),
      clay("#cfd5e3", 0.4),
    );
    head.position.x = 0.44;
    arm.add(head);
    arm.position.set(0.3, -0.05, 0.12);
    body.add(arm);
    g.userData.arm = arm;
    body.position.y = 0.3;
    tool = new THREE.Vector3(0.74, 0.25, 0.12);
  } else {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.42);
    shape.lineTo(0.32, 0.3);
    shape.lineTo(0.32, 0.02);
    shape.quadraticCurveTo(0.3, -0.3, 0, -0.42);
    shape.quadraticCurveTo(-0.3, -0.3, -0.32, 0.02);
    shape.lineTo(-0.32, 0.3);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.18,
      bevelEnabled: true,
      bevelSize: 0.04,
      bevelThickness: 0.04,
      bevelSegments: 3,
    });
    geo.translate(0, 0, -0.09);
    body.add(inked(geo, base, { outline: false }));
    const check = new THREE.Mesh(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(
          [
            new THREE.Vector3(-0.14, 0.02, 0),
            new THREE.Vector3(-0.03, -0.1, 0),
            new THREE.Vector3(0.17, 0.14, 0),
          ],
          false,
          "catmullrom",
          0,
        ),
        20,
        0.035,
        8,
      ),
      glow("#ffffff"),
    );
    check.position.z = 0.14;
    body.add(check);
    g.userData.check = check;
    body.position.y = 0.44;
    tool = new THREE.Vector3(0, 0.5, 0.25);
  }
  if (id === "scout") eyes(0.48, 0.17, 0.08);
  g.add(body);
  g.userData.body = body;
  g.userData.tool = tool;
  // Soft contact shadow and the selection ring on the floor.
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.36, 24),
    new THREE.MeshBasicMaterial({
      color: "#0a0c14",
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  g.userData.shadow = shadow;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.46, 0.52, 40),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  g.userData.ring = ring;
  g.traverse((o) => {
    if (o.isMesh) o.userData.agent = id;
  });
  return g;
}

function buildStation(color) {
  const s = new THREE.Group();
  const pad = inked(
    new RoundedBoxGeometry(1.5, 0.12, 1.5, 3, 0.05),
    clay("#f7f6f3"),
  );
  pad.position.y = 0.06;
  s.add(pad);
  const consoleBox = inked(
    new RoundedBoxGeometry(0.62, 0.62, 0.32, 3, 0.06),
    clay("#f1f0ec"),
  );
  consoleBox.position.set(0, 0.43, -0.55);
  s.add(consoleBox);
  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(0.44, 0.06, 0.02),
    glow(color),
  );
  strip.position.set(0, 0.52, -0.385);
  s.add(strip);
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 14, 14),
    glow("#c9ced8"),
  );
  lamp.position.set(0.2, 0.36, -0.385);
  s.add(lamp);
  s.userData.lamp = lamp;
  return s;
}

export default function AgentScene({
  agents,
  selected,
  onPick,
  revealed,
  projectName,
}) {
  const box = useRef(null),
    canvas = useRef(null),
    labels = useRef({}),
    tag = useRef(null),
    latest = useRef({ agents, selected, revealed, onPick });
  latest.current = { agents, selected, revealed, onPick };
  useEffect(() => {
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: canvas.current,
        antialias: true,
        alpha: true,
      });
    } catch {
      return;
    }
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    camera.position.set(11, 9.5, 11);
    const controls = new OrbitControls(camera, canvas.current);
    controls.target.set(0, 1.25, 0);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minZoom = 0.7;
    controls.maxZoom = 2.2;
    controls.minPolarAngle = 0.5;
    controls.maxPolarAngle = 1.25;
    controls.autoRotate = !still;
    controls.autoRotateSpeed = 0.35;

    scene.add(new THREE.HemisphereLight("#ffffff", "#e6e8ee", 1.6));
    const sun = new THREE.DirectionalLight("#ffffff", 1.6);
    sun.position.set(6, 12, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -8;
    sun.shadow.camera.right = 8;
    sun.shadow.camera.top = 8;
    sun.shadow.camera.bottom = -8;
    sun.shadow.radius = 4;
    sun.shadow.bias = -0.0005;
    scene.add(sun);

    // Floor: white, a faint grid, shadows only.
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.ShadowMaterial({ opacity: 0.1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const grid = new THREE.GridHelper(16, 32, "#e3e6ee", "#eef0f5");
    grid.position.y = 0.002;
    scene.add(grid);
    // Landing pad.
    const pad = inked(
      new THREE.CylinderGeometry(2.2, 2.3, PAD_TOP, 64),
      clay("#fafaf8"),
      { threshold: 20 },
    );
    pad.position.y = PAD_TOP / 2;
    scene.add(pad);
    const mark = new THREE.Mesh(
      new THREE.RingGeometry(1.35, 1.42, 64),
      glow("#d7dbe4"),
    );
    mark.rotation.x = -Math.PI / 2;
    mark.position.y = PAD_TOP + 0.003;
    scene.add(mark);
    const heat = new THREE.Mesh(
      new THREE.CircleGeometry(1.3, 40),
      new THREE.MeshBasicMaterial({
        color: "#ff8a3d",
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    heat.rotation.x = -Math.PI / 2;
    heat.position.y = PAD_TOP + 0.005;
    scene.add(heat);
    const dust = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.1, 48),
      new THREE.MeshBasicMaterial({
        color: "#c9ced8",
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    dust.rotation.x = -Math.PI / 2;
    dust.position.y = PAD_TOP + 0.01;
    scene.add(dust);

    // Rocket and its flame.
    const rocket = buildRocket();
    const REST_Y = PAD_TOP + 0.62;
    rocket.position.y = still ? REST_Y : REST_Y + 12;
    scene.add(rocket);
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.62, 2.6, 32, 1, true),
      flameMaterial(),
    );
    flame.rotation.x = Math.PI;
    flame.position.y = -1.3;
    rocket.add(flame);
    const flameU = flame.material.uniforms;

    // Effects used while agents work.
    const scanRing = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.025, 8, 64),
      glow("#2f6bff", 0.85),
    );
    scanRing.rotation.x = Math.PI / 2;
    scanRing.visible = false;
    rocket.add(scanRing);
    const bars = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 1, 0.12),
        glow("#0fa58c", 0.85),
      );
      b.geometry.translate(0, 0.5, 0);
      b.position.x = i * 0.2;
      bars.add(b);
    }
    bars.visible = false;
    scene.add(bars);
    const pulse = new THREE.Mesh(
      new THREE.RingGeometry(0.95, 1.0, 64),
      new THREE.MeshBasicMaterial({
        color: "#e0602c",
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    pulse.rotation.x = -Math.PI / 2;
    pulse.position.y = PAD_TOP + 0.012;
    scene.add(pulse);
    const sparkCount = 60;
    const sparkPos = new Float32Array(sparkCount * 3),
      sparkVel = new Float32Array(sparkCount * 3),
      sparkLife = new Float32Array(sparkCount);
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3));
    const sparks = new THREE.Points(
      sparkGeo,
      new THREE.PointsMaterial({
        color: "#ffb340",
        size: 0.07,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    sparks.frustumCulled = false;
    scene.add(sparks);
    const beamGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(),
    ]);
    const beam = new THREE.Line(
      beamGeo,
      new THREE.LineBasicMaterial({
        color: "#2f6bff",
        transparent: true,
        opacity: 0.85,
      }),
    );
    beam.frustumCulled = false;
    beam.visible = false;
    scene.add(beam);
    const hit = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 14, 14),
      glow("#ffffff"),
    );
    hit.visible = false;
    scene.add(hit);

    // Stations, tracks to the pad and the agents.
    const actors = {};
    for (const a of latest.current.agents) {
      const [sx, sz] = STATIONS[a.id];
      const station = buildStation(a.color);
      station.position.set(sx, 0, sz);
      station.lookAt(0, 0, 0);
      station.rotateY(Math.PI);
      scene.add(station);
      const dir = new THREE.Vector3(-sx, 0, -sz).normalize();
      const from = new THREE.Vector3(sx, 0, sz).addScaledVector(dir, 0.8),
        to = dir.clone().multiplyScalar(-2.25);
      const len = from.distanceTo(to);
      const track = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.02, len),
        clay("#eceef3"),
      );
      track.position.copy(from).add(to).multiplyScalar(0.5).setY(0.012);
      track.lookAt(to.x, 0.012, to.z);
      track.receiveShadow = true;
      scene.add(track);
      const packets = [0, 1, 2].map((k) => {
        const p = new THREE.Mesh(
          new THREE.SphereGeometry(0.06, 12, 12),
          glow(a.color),
        );
        p.userData.k = k / 3;
        p.visible = false;
        scene.add(p);
        return p;
      });
      const agent = buildAgent(a.id, a.color);
      const home = new THREE.Vector3(sx, 0, sz).addScaledVector(dir, 0.1);
      agent.position.copy(home);
      agent.scale.setScalar(0.001);
      scene.add(agent);
      scene.add(agent.userData.shadow, agent.userData.ring);
      const work = dir.clone().multiplyScalar(-2.05);
      actors[a.id] = {
        agent,
        station,
        home,
        work,
        from,
        to,
        packets,
        appear: 0,
        at: 0,
      };
    }

    // Picking: click (not drag) on an agent, and a pointer cursor over one.
    const ray = new THREE.Raycaster(),
      ndc = new THREE.Vector2();
    let down = null;
    const pickAt = (e) => {
      const r = canvas.current.getBoundingClientRect();
      ndc.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      );
      ray.setFromCamera(ndc, camera);
      const hitObj = ray.intersectObjects(
        Object.values(actors).map((x) => x.agent),
        true,
      )[0];
      return hitObj?.object.userData.agent || null;
    };
    const onDown = (e) => (down = [e.clientX, e.clientY]);
    const onUp = (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5)
        return;
      const id = pickAt(e);
      if (id) latest.current.onPick(id);
    };
    let hoverAt = 0;
    const onMove = (e) => {
      const now = performance.now();
      if (now - hoverAt < 60) return;
      hoverAt = now;
      canvas.current.style.cursor = pickAt(e) ? "pointer" : "";
    };
    canvas.current.addEventListener("pointerdown", onDown);
    canvas.current.addEventListener("pointerup", onUp);
    canvas.current.addEventListener("pointermove", onMove);

    const resize = () => {
      if (!box.current) return;
      const w = box.current.clientWidth,
        h = box.current.clientHeight;
      renderer.setSize(w, h, false);
      const aspect = w / h,
        view = aspect > 1.4 ? 4.3 : 5.6;
      camera.left = -view * aspect;
      camera.right = view * aspect;
      camera.top = view;
      camera.bottom = -view;
      camera.updateProjectionMatrix();
    };
    const watcher = new ResizeObserver(resize);
    watcher.observe(box.current);
    resize();

    let raf = 0,
      last = performance.now(),
      clock = 0,
      landT = still ? LAND_SECONDS : -1,
      explode = 0,
      sparkIx = 0;
    const tmp = new THREE.Vector3(),
      target = new THREE.Vector3(),
      screen = new THREE.Vector3();
    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (!canvas.current) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      clock += dt;
      const { agents: list, selected: sel, revealed } = latest.current;
      // Landing: starts once the page has been revealed.
      if (landT < 0 && revealed) landT = 0;
      if (landT >= 0 && landT < LAND_SECONDS + 1.4) landT += dt;
      const lt = Math.min(1, Math.max(0, landT) / LAND_SECONDS);
      const descend = 1 - Math.pow(1 - lt, 3);
      rocket.position.y = REST_Y + (1 - descend) * 12;
      const firing = landT >= 0 && landT < LAND_SECONDS + 0.25;
      const power = firing
        ? Math.min(1, 0.35 + (1 - lt) * 0.9) *
          (landT > LAND_SECONDS ? 1 - (landT - LAND_SECONDS) / 0.25 : 1)
        : 0;
      flame.visible = power > 0.01;
      flameU.uPower.value = Math.max(0, power);
      flameU.uTime.value = clock;
      flame.scale.set(1, 0.6 + power * 0.6, 1);
      heat.material.opacity = Math.max(0, power) * 0.35 * smooth(lt);
      const touch = landT - LAND_SECONDS;
      dust.material.opacity =
        touch > 0 && touch < 1.2 ? 0.5 * (1 - touch / 1.2) : 0;
      dust.scale.setScalar(1 + Math.max(0, touch) * 1.8);
      const landed = landT >= LAND_SECONDS;

      // Who is working, and on what.
      const active = list.find((a) => a.state === "working");
      for (const a of list) {
        const act = actors[a.id];
        if (!act) continue;
        const ag = act.agent,
          ud = ag.userData;
        // Agents come out of their stations after touchdown, one by one.
        const order = ["scout", "gauge", "smith", "warden"].indexOf(a.id);
        if (landed && landT - LAND_SECONDS > order * 0.15)
          act.appear = Math.min(1, act.appear + dt * 2.2);
        const pop =
          act.appear < 1 ? 1 + Math.sin(act.appear * Math.PI) * 0.25 : 1;
        ag.scale.setScalar(
          Math.max(0.001, smooth(act.appear) * pop * AGENT_SIZE),
        );
        const working = a.state === "working" && landed;
        target.copy(working ? act.work : act.home);
        ag.position.x += (target.x - ag.position.x) * Math.min(1, dt * 3.6);
        ag.position.z += (target.z - ag.position.z) * Math.min(1, dt * 3.6);
        const travel = Math.hypot(
          target.x - ag.position.x,
          target.z - ag.position.z,
        );
        act.at = travel < 0.15 ? Math.min(1, act.at + dt * 3) : 0;
        ag.position.y =
          0.42 +
          Math.sin(clock * 2.4 + order) * 0.06 +
          (travel > 0.2 ? 0.12 : 0);
        // Face the rocket while working, the pad otherwise.
        const face = Math.atan2(-ag.position.x, -ag.position.z);
        ag.rotation.y = face;
        ud.shadow.position.set(ag.position.x, 0.014, ag.position.z);
        ud.shadow.scale.setScalar(ag.scale.x);
        ud.ring.position.set(ag.position.x, 0.016, ag.position.z);
        ud.ring.material.opacity +=
          ((sel === a.id ? 0.9 : 0) - ud.ring.material.opacity) *
          Math.min(1, dt * 6);
        ud.ring.scale.setScalar(
          1 + (sel === a.id ? Math.sin(clock * 4) * 0.05 : 0),
        );
        // Idle character animation.
        if (ud.needle)
          ud.needle.rotation.z = working ? Math.sin(clock * 5) * 1.1 : -0.8;
        if (ud.tip)
          ud.tip.material.color.set(
            working && Math.sin(clock * 10) > 0 ? "#ffffff" : "#7ff0d8",
          );
        if (ud.arm)
          ud.arm.rotation.z = working ? Math.sin(clock * 14) * 0.35 : 0;
        if (ud.check)
          ud.check.scale.setScalar(
            working ? 1 + Math.max(0, Math.sin(clock * 4)) * 0.25 : 1,
          );
        // Station lamp.
        act.station.userData.lamp.material.color.set(
          a.state === "working"
            ? a.color
            : a.state === "done"
              ? "#0f8a5f"
              : "#c9ced8",
        );
        // Data packets run along the track toward the pad while working.
        act.packets.forEach((p) => {
          p.visible = working;
          if (!working) return;
          const k = (clock * 0.55 + p.userData.k) % 1;
          p.position.lerpVectors(act.from, act.to, k).setY(0.09);
        });
      }

      // The working agent's effect on the rocket.
      const id = landed && active ? active.id : null;
      const act = id && actors[id];
      const ready = act && act.at > 0.6;
      scanRing.visible = id === "scout" && ready;
      if (scanRing.visible) {
        const y = 0.1 + (Math.sin(clock * 1.6) * 0.5 + 0.5) * 2.5;
        scanRing.position.y = y;
        const r =
          y < 1.25
            ? 0.24 + 0.56 * Math.pow(1 - y / 1.25, 0.6)
            : y < 1.95
              ? 0.42
              : 0.7;
        scanRing.scale.setScalar(r + 0.12);
      }
      bars.visible = id === "gauge" && ready;
      if (bars.visible) {
        const p = act.work.clone().multiplyScalar(0.55);
        bars.position.set(p.x, PAD_TOP, p.z);
        bars.lookAt(0, PAD_TOP, 0);
        bars.children.forEach(
          (b, i) =>
            (b.scale.y =
              0.25 + (Math.sin(clock * 3 + i * 1.3) * 0.5 + 0.5) * 1.1),
        );
      }
      explode +=
        ((id === "smith" && ready ? 1 : 0) - explode) * Math.min(1, dt * 3);
      for (const p of rocket.userData.parts)
        p.position
          .copy(p.userData.home)
          .addScaledVector(
            p.userData.out,
            explode * (0.75 + 0.1 * Math.sin(clock * 2)),
          );
      const wardenOn = id === "warden" && ready;
      pulse.material.opacity = wardenOn ? 0.6 * (1 - ((clock * 0.8) % 1)) : 0;
      pulse.scale.setScalar(1 + ((clock * 0.8) % 1) * 0.9);
      const lineColor = wardenOn
        ? Math.sin(clock * 3) > 0
          ? "#e0602c"
          : "#0f8a5f"
        : null;
      rocket.traverse((o) => {
        if (o.isLineSegments) {
          o.material.color.set(lineColor || ink);
          o.material.opacity = lineColor ? 0.85 : 0.32;
        }
      });
      // Beam from the agent's tool to a point on the rocket.
      beam.visible = hit.visible = Boolean(ready);
      if (ready) {
        const ag = act.agent;
        tmp.copy(ag.userData.tool).applyMatrix4(ag.matrixWorld);
        const h = 0.6 + (Math.sin(clock * 1.3) * 0.5 + 0.5) * 1.6;
        target.set(act.work.x * 0.18, rocket.position.y + h, act.work.z * 0.18);
        beamGeo.attributes.position.setXYZ(0, tmp.x, tmp.y, tmp.z);
        beamGeo.attributes.position.setXYZ(1, target.x, target.y, target.z);
        beamGeo.attributes.position.needsUpdate = true;
        beam.material.color.set(active.color);
        hit.position.copy(target);
        hit.scale.setScalar(0.8 + Math.sin(clock * 20) * 0.25);
        // Smith throws sparks where it works.
        if (id === "smith")
          for (let n = 0; n < 2; n++) {
            const i = sparkIx++ % sparkCount;
            sparkPos.set([target.x, target.y, target.z], i * 3);
            sparkVel.set(
              [rand(-1.2, 1.2), rand(0.5, 2), rand(-1.2, 1.2)],
              i * 3,
            );
            sparkLife[i] = rand(0.4, 0.8);
          }
      }
      for (let i = 0; i < sparkCount; i++) {
        if (sparkLife[i] <= 0) {
          sparkPos[i * 3 + 1] = -50;
          continue;
        }
        sparkLife[i] -= dt;
        sparkVel[i * 3 + 1] -= 6 * dt;
        sparkPos[i * 3] += sparkVel[i * 3] * dt;
        sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
        sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
      }
      sparkGeo.attributes.position.needsUpdate = true;

      controls.update();
      renderer.render(scene, camera);

      // Labels follow their agents on screen.
      const rect = canvas.current.getBoundingClientRect();
      for (const a of list) {
        const el = labels.current[a.id],
          act2 = actors[a.id];
        if (!el || !act2) continue;
        screen
          .copy(act2.agent.position)
          .setY(act2.agent.position.y + 1.05 * AGENT_SIZE)
          .project(camera);
        el.style.transform = `translate(${((screen.x + 1) / 2) * rect.width}px, ${((1 - screen.y) / 2) * rect.height}px) translate(-50%, -100%)`;
        el.style.opacity = act2.appear > 0.5 ? 1 : 0;
      }
      if (tag.current) {
        screen.set(0, rocket.position.y + 3.35, 0).project(camera);
        tag.current.style.transform = `translate(${((screen.x + 1) / 2) * rect.width}px, ${((1 - screen.y) / 2) * rect.height}px) translate(-50%, -100%)`;
        tag.current.style.opacity = landed ? 1 : 0;
      }
    }
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      watcher.disconnect();
      controls.dispose();
      const c = canvas.current;
      if (c) {
        c.removeEventListener("pointerdown", onDown);
        c.removeEventListener("pointerup", onUp);
        c.removeEventListener("pointermove", onMove);
      }
      scene.traverse((o) => {
        o.geometry?.dispose?.();
        o.material?.dispose?.();
      });
      renderer.dispose();
    };
  }, []);
  const statusText = { working: "Working", done: "Done", waiting: "Waiting" };
  return (
    <div className="agent-scene" ref={box}>
      <canvas className="agent-canvas" ref={canvas} aria-hidden="true" />
      <span className="scene-tag" ref={tag} aria-hidden="true">
        {projectName}
      </span>
      {agents.map((a) => (
        <button
          key={a.id}
          type="button"
          ref={(el) => (labels.current[a.id] = el)}
          className={
            "scene-label " + a.state + (selected === a.id ? " selected" : "")
          }
          style={{ "--c": a.color }}
          aria-pressed={selected === a.id}
          aria-label={`${a.name}, ${a.role}. ${statusText[a.state]}. Show what ${a.name} is working on.`}
          onClick={() => onPick(a.id)}
        >
          <b>{a.name}</b>
          <span className={"agent-state " + a.state}>
            {statusText[a.state]}
          </span>
        </button>
      ))}
      <p className="scene-help" aria-hidden="true">
        Drag to turn · scroll to zoom · click an agent
      </p>
    </div>
  );
}
