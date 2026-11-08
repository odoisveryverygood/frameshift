// Evaluation application: multi-part carts move inside translated lane groups.
export function createWorld(THREE, scene) {
  const carts = [];
  const lanes = [];
  for (let laneIndex = 0; laneIndex < 5; laneIndex++) {
    const lane = new THREE.Group();
    lane.name = "lane-" + laneIndex;
    lane.position.z = (laneIndex - 2) * 2.1;
    scene.add(lane);
    lanes.push(lane);
    for (let slot = 0; slot < 24; slot++) {
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.48, 0.36, 0.62),
        new THREE.MeshStandardMaterial({ color: slot % 3 ? 0x4f8a9b : 0xc18450, roughness: 0.43, metalness: 0.15 })
      );
      body.name = "cart-" + laneIndex + "-" + slot;
      body.userData.semanticId = body.name;
      const cargo = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 0.24, 0.34),
        new THREE.MeshStandardMaterial({ color: 0x8c9470, roughness: 0.8 })
      );
      cargo.name = "cargo-" + laneIndex + "-" + slot;
      cargo.userData.semanticId = cargo.name;
      body.position.set((slot - 11.5) * 0.62, 0, 0);
      cargo.position.set(body.position.x, 0.3, 0);
      lane.add(body, cargo);
      carts.push({ body, cargo, slot, laneIndex });
    }
  }
  return {
    update(seconds) {
      for (const cart of carts) {
        const offset = Math.sin(seconds * 0.6 + cart.laneIndex) * 0.18;
        cart.body.position.x = (cart.slot - 11.5) * 0.62 + offset;
        cart.cargo.position.x = cart.body.position.x;
        cart.body.rotation.y = Math.sin(seconds + cart.slot) * 0.08;
        cart.cargo.rotation.y = cart.body.rotation.y;
      }
      for (let i = 0; i < lanes.length; i++) lanes[i].position.y = Math.sin(seconds * 0.4 + i) * 0.04;
    }
  };
}
