// Evaluation application: rotating subassemblies and two cylinder dimensions.
export function createWorld(THREE, scene) {
  const turntable = new THREE.Group();
  turntable.name = "turntable";
  turntable.position.y = 0.25;
  scene.add(turntable);
  const modules = [];
  const parts = [];
  for (let row = 0; row < 6; row++) {
    const module = new THREE.Group();
    module.name = "module-" + row;
    module.position.set(0, 0, (row - 2.5) * 1.8);
    turntable.add(module);
    modules.push(module);
    for (let column = 0; column < 20; column++) {
      const wide = column % 4 === 0;
      const part = new THREE.Mesh(
        new THREE.CylinderGeometry(wide ? 0.34 : 0.24, wide ? 0.34 : 0.24, 0.72, 12),
        new THREE.MeshStandardMaterial({ color: row % 2 ? 0xa8734f : 0x576d8e, metalness: 0.25, roughness: 0.5 })
      );
      part.name = "spindle-" + row + "-" + column;
      part.userData.semanticId = part.name;
      part.position.set((column - 9.5) * 0.72, 0, 0);
      module.add(part);
      parts.push(part);
    }
  }
  return {
    update(t) {
      turntable.rotation.y = Math.sin(t * 0.21) * 0.12;
      for (let row = 0; row < modules.length; row++) modules[row].rotation.x = Math.sin(t * 0.5 + row) * 0.08;
      for (let index = 0; index < parts.length; index++) parts[index].rotation.z = Math.sin(t + index * 0.17) * 0.12;
    }
  };
}
