import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROBOT_COUNT, robotPose } from './simulation.js';

/** Rendering implementation. Preserve shapes, materials, motion and semantic identity. */
export function createFleet(THREE, scene) {
  const robots = [];
  for (let i = 0; i < ROBOT_COUNT; i++) {
    const root = new THREE.Group();
    const color = Math.floor(i / 100) % 2 ? 0x447b78 : 0xd9954e;
    const body = new THREE.Mesh(new THREE.BoxGeometry(.88, .30, 1.08), new THREE.MeshStandardMaterial({ color, roughness: .54, metalness: .18 }));
    body.position.y = .29;
    body.userData.semanticId = 'robot-' + i;
    body.name = 'AMR ' + String(i + 1).padStart(4, '0');
    root.add(body);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(.66, .10, .76), new THREE.MeshStandardMaterial({ color: 0xede9dc, roughness: .8, metalness: .05 }));
    deck.position.y = .49;
    root.add(deck);
    const wheelParts = [];
    for (const x of [-.44, .44]) for (const z of [-.32, .32]) {
      const geometry = new THREE.CylinderGeometry(.14, .14, .10, 8).rotateZ(Math.PI / 2).translate(x, .14, z);
      wheelParts.push(geometry);
    }
    const wheels = new THREE.Mesh(mergeGeometries(wheelParts), new THREE.MeshStandardMaterial({ color: 0x26312e, roughness: .92 }));
    wheelParts.forEach(g => g.dispose());
    root.add(wheels);
    scene.add(root);
    robots.push(root);
  }
  return {
    update(time) {
      for (let i = 0; i < ROBOT_COUNT; i++) {
        const pose = robotPose(i, time);
        robots[i].position.copy(new THREE.Vector3(pose.x, 0, pose.z));
        robots[i].rotation.y = pose.heading;
      }
    }
  };
}
