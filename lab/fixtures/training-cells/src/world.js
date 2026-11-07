// Training application: animated individual cells. Optimize without changing their identities.
export function createWorld(THREE, scene) {
  const cells = [];
  for (let i = 0; i < 196; i++) {
    const cell = new THREE.Mesh(
      new THREE.BoxGeometry(0.62, 0.62, 0.62),
      new THREE.MeshStandardMaterial({ color: i % 2 ? 0x507a70 : 0x6379a8, roughness: 0.6 })
    );
    cell.name = "cell-" + i;
    cell.userData.semanticId = cell.name;
    cell.position.set(i % 14 - 6.5, 0, Math.floor(i / 14) - 6.5);
    scene.add(cell);
    cells.push(cell);
  }
  return {
    update(time) {
      for (let i = 0; i < cells.length; i++) {
        cells[i].rotation.y = time * 0.4 + i * 0.1;
        cells[i].position.y = Math.sin(time * 1.2 + i * 0.3) * 0.12;
      }
    }
  };
}
