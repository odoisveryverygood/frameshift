/** Static environment is batched separately from the fleet. */
export function createWarehouse(THREE, scene) {
  scene.background = new THREE.Color(0xe9ede7);
  scene.fog = new THREE.Fog(0xe9ede7, 115, 240);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x889481, 2.7));
  const sun = new THREE.DirectionalLight(0xfff5df, 2.8); sun.position.set(-15, 35, 18); scene.add(sun);
  const add = mesh => {mesh.userData.frameshiftIgnore = true; scene.add(mesh);return mesh;};
  const floor = add(new THREE.Mesh(new THREE.PlaneGeometry(125, 106), new THREE.MeshStandardMaterial({color:0xdce1d4,roughness:.96})));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -.025;
  const grid = new THREE.GridHelper(120, 60, 0xcbd3c4, 0xd2d9ca); grid.position.y = -.015; scene.add(grid);
  const matrix = new THREE.Matrix4();
  function boxes(geometry, color, placements) {
    const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial({color,roughness:.84}), placements.length);
    placements.forEach((p, i) => {matrix.makeTranslation(...p);mesh.setMatrixAt(i,matrix);});
    mesh.instanceMatrix.needsUpdate = true; return add(mesh);
  }
  const lines=[];
  for(let i=0;i<20;i++)lines.push([0,.005,(i-9.5)*3.3]);
  boxes(new THREE.BoxGeometry(75,.012,.035),0xc2cbb8,lines);
  const bases=[],pillars=[],shelves=[],crates=[];
  for(const side of [-1,1])for(let row=0;row<20;row++) {
    const x=side*43.5,z=(row-9.5)*3.3;
    bases.push([x,.08,z]);
    for(const dz of [-.85,.85])for(const dx of [-.7,.7])pillars.push([x+dx,1.5,z+dz]);
    for(const y of [.65,1.5,2.35]) {
      shelves.push([x,y,z]);
      for(const dz of [-.43,.43])crates.push([x,y+.25,z+dz]);
    }
  }
  boxes(new THREE.BoxGeometry(2,.16,2.2),0x60756b,bases);
  boxes(new THREE.BoxGeometry(.09,3,.09),0x708579,pillars);
  boxes(new THREE.BoxGeometry(1.6,.08,1.8),0x899c87,shelves);
  boxes(new THREE.BoxGeometry(1.25,.43,.7),0xb9a37e,crates);
  const zoneMat = new THREE.MeshBasicMaterial({color:0xe7c496,transparent:true,opacity:.35,depthWrite:false});
  for(const x of [-39.2,39.2]) {
    const strip=add(new THREE.Mesh(new THREE.PlaneGeometry(1.6,67),zoneMat));strip.rotation.x=-Math.PI/2;strip.position.set(x,.008,0);
  }
}
