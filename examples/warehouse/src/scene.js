// Preserve every semantic object, material, geometry, animation and picking identity.
// semanticId identifies an ordinary mesh; semanticIds identifies each instance.
export function createWorld(THREE, scene) {
  const count = 1600;
  const robots = [];
  for (let i = 0; i < count; i++) {
    const geometry = new THREE.BoxGeometry(.72, .48, .94);
    const material = new THREE.MeshStandardMaterial({color: i % 3 === 0 ? 0xf59b52 : 0x4f8ca8, roughness: .42, metalness: .35});
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.semanticId = 'robot-' + i;
    scene.add(mesh);
    robots.push(mesh);
  }
  return {
    update(t) {
      for (let i = 0; i < count; i++) {
        const column = i % 40;
        const row = Math.floor(i / 40);
        const position = new THREE.Vector3((column - 19.5) * 1.25, .32 + Math.sin(t * 1.8 + i * .13) * .04, (row - Math.floor(count / 40) / 2) * 1.3 + Math.sin(t * .4 + column * .2) * .4);
        robots[i].position.copy(position);
        robots[i].rotation.y = Math.sin(t * .5 + i * .04) * .18;
      }
    }
  };
}
