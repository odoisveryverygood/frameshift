import * as THREE from "three";
import { createWorld } from "./world.js";
const scene = new THREE.Scene();
scene.background = new THREE.Color("#e8e4dc");
const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.1, 120);
camera.position.set(15, 13, 19);
camera.lookAt(0, 0, 0);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff, 0x6e7783, 3));
const world = createWorld(THREE, scene);
const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  world.update(clock.getElapsedTime());
  renderer.render(scene, camera);
}
frame();
const ray = new THREE.Raycaster();
renderer.domElement.addEventListener("click", (event) => {
  ray.setFromCamera(new THREE.Vector2(event.clientX / innerWidth * 2 - 1, 1 - event.clientY / innerHeight * 2), camera);
  const hit = ray.intersectObjects(scene.children, true).find((entry) => entry.object.isMesh);
  const identity = hit ? (hit.object.isInstancedMesh ? hit.object.userData.semanticIds?.[hit.instanceId] : hit.object.userData.semanticId || hit.object.name) : null;
  document.querySelector("output").textContent = identity || "Nothing selected";
});
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
