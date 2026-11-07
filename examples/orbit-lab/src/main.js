import * as THREE from "three";
import "./style.css";

const viewport = document.querySelector("#viewport");
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
} catch {
  const error = document.querySelector("#render-error");
  error.hidden = false;
  error.textContent =
    "Orbit Lab needs WebGL2. Enable hardware acceleration or try a browser with WebGL2 support.";
  document.querySelector("#pause").disabled = true;
  throw Error("Orbit Lab could not create a WebGL2 renderer.");
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.domElement.tabIndex = 0;
renderer.domElement.setAttribute(
  "aria-label",
  "Orbit Lab scene. Click to select an object; Enter selects the beacon.",
);
viewport.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#152b32");
const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 100);
camera.position.set(0, 15, 20);
camera.lookAt(0, 0, 0);
scene.add(new THREE.HemisphereLight(0xe8f5f2, 0x30434e, 3));
const key = new THREE.DirectionalLight(0xffe2b4, 3);
key.position.set(-8, 10, 5);
scene.add(key);

const beacon = new THREE.Mesh(
  new THREE.SphereGeometry(1.15, 24, 16),
  new THREE.MeshStandardMaterial({
    color: 0xf5c077,
    roughness: 0.45,
    metalness: 0.15,
  }),
);
beacon.name = "Beacon";
scene.add(beacon);
const selectable = [beacon];
const satellites = [];
const colors = [0x9acac1, 0xd49d79, 0xb0bdcf, 0xe6cc9b];
for (let ring = 0; ring < 4; ring++) {
  const radius = 3.5 + ring * 1.65;
  const track = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.018, 6, 160),
    new THREE.MeshBasicMaterial({ color: 0x4e6970 }),
  );
  track.name = `Orbit track ${ring + 1}`;
  track.rotation.x = Math.PI / 2;
  scene.add(track);
  for (let index = 0; index < 60; index++) {
    // Intentionally ordinary separate meshes/materials: a rendering optimization exercise.
    // Identity, animated world transforms and selection must survive any optimization.
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.22, 0.38),
      new THREE.MeshStandardMaterial({
        color: colors[ring],
        roughness: 0.6,
        metalness: 0.2,
      }),
    );
    mesh.name = `Satellite ${ring + 1}-${String(index + 1).padStart(2, "0")}`;
    const phase = (index / 60) * Math.PI * 2 + ring * 0.12;
    satellites.push({
      mesh,
      radius,
      phase,
      speed: (ring % 2 ? -1 : 1) * (0.24 - ring * 0.035),
    });
    selectable.push(mesh);
    scene.add(mesh);
  }
}

let paused = false;
let elapsed = 0;
let lastTime;
let selected = null;
const selection = document.querySelector("#selection");
function select(mesh) {
  if (selected) selected.material.emissive.setHex(0);
  selected = mesh || null;
  if (selected) selected.material.emissive.setHex(0x493220);
  selection.textContent = selected
    ? `Selected: ${selected.name}`
    : "Nothing selected";
}
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
renderer.domElement.addEventListener("click", (event) => {
  const bounds = renderer.domElement.getBoundingClientRect();
  pointer.set(
    ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
    -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
  );
  raycaster.setFromCamera(pointer, camera);
  select(raycaster.intersectObjects(selectable, false)[0]?.object);
});
renderer.domElement.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    select(beacon);
  }
  if (event.key === "Escape") select(null);
});
const pause = document.querySelector("#pause");
pause.addEventListener("click", () => {
  paused = !paused;
  pause.setAttribute("aria-pressed", String(paused));
  pause.textContent = paused ? "Resume orbits" : "Pause orbits";
  document.querySelector("#motion").textContent = paused
    ? "Orbits paused"
    : "Orbits running";
});

function resize() {
  const { width, height } = viewport.getBoundingClientRect();
  if (!width || !height) return;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  camera.aspect = width / height;
  // Keep all four rings visible even in a narrow phone viewport.
  camera.fov = THREE.MathUtils.radToDeg(
    2 *
      Math.atan(
        Math.tan(THREE.MathUtils.degToRad(44 / 2)) / Math.min(1, camera.aspect),
      ),
  );
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewport);
window.addEventListener("resize", resize);
resize();
function animate(timestamp) {
  requestAnimationFrame(animate);
  const delta =
    lastTime === undefined
      ? 0
      : Math.max(0, Math.min((timestamp - lastTime) / 1000, 0.05));
  lastTime = timestamp;
  if (!paused) elapsed += delta;
  for (const { mesh, radius, phase, speed } of satellites) {
    const angle = phase + elapsed * speed;
    mesh.position.set(
      Math.cos(angle) * radius,
      Math.sin(angle * 2 + phase) * 0.25,
      Math.sin(angle) * radius,
    );
    mesh.rotation.set(0, -angle, 0);
  }
  renderer.render(scene, camera);
}
requestAnimationFrame(animate);
