/* Shared scene inspector. DOM markers never add WebGL submissions. */
export function snapshotCamera(camera) {
  return { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), projection: camera.projectionMatrix.toArray(), up: camera.up.toArray() };
}
export function validCamera(state) {
  return state && [["position", 3], ["quaternion", 4], ["projection", 16], ["up", 3]].every(([key, length]) => Array.isArray(state[key]) && state[key].length === length && state[key].every(Number.isFinite));
}
export function restoreCamera(camera, state) {
  if (!validCamera(state)) throw Error("Invalid scene camera state");
  camera.position.fromArray(state.position); camera.quaternion.fromArray(state.quaternion); camera.up.fromArray(state.up);
  camera.projectionMatrix.fromArray(state.projection); camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert(); camera.updateMatrixWorld(true);
}
export function resolveSelection(THREE, scene, camera, id, identify) {
  if (!scene || !camera || id == null) return null;
  let found = null;
  scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
  scene.traverse(mesh => {
    if (found || !mesh.isMesh || mesh.userData.frameshiftIgnore) return;
    const meshId = identify(mesh, scene) ?? (mesh.userData.semanticIds?.length ? `group/${mesh.userData.semanticIds[0]}` : null);
    let instanceId = null;
    if (mesh.isInstancedMesh) {
      const ids = mesh.userData.semanticIds;
      instanceId = Array.isArray(ids) ? ids.findIndex(value => String(value) === String(id)) : -1;
      if (instanceId < 0 && meshId != null && String(id).startsWith(String(meshId) + "/instance-")) {
        const number = Number(String(id).slice(String(meshId).length + 10));
        if (Number.isInteger(number) && number >= 0 && number < mesh.count) instanceId = number;
      }
      if (instanceId < 0) return;
    } else if (meshId == null || String(meshId) !== String(id)) return;
    const matrix = new THREE.Matrix4();
    if (instanceId != null) { mesh.getMatrixAt(instanceId, matrix); matrix.premultiply(mesh.matrixWorld); } else matrix.copy(mesh.matrixWorld);
    const world = new THREE.Vector3().setFromMatrixPosition(matrix);
    const projected = world.clone().project(camera);
    const material = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    found = { id: String(id), meshId: String(meshId), instanceId, name: mesh.name || String(id), type: mesh.type,
      geometry: mesh.geometry?.type || null, materialCount: material.length,
      groupInstanceCount: mesh.isInstancedMesh ? mesh.count : 1,
      worldPosition: world.toArray(), anchor: { x: (projected.x + 1) / 2, y: (1 - projected.y) / 2, visible: projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1 } };
  });
  return found;
}
export function installSpatialBridge(THREE, options) {
  const api = options.api;
  if (api.spatialContext) return api.spatialContext;
  const controlled = new URLSearchParams(location.search).get('__frameshift') === '1';
  const identify = options.identify;
  const canvas = options.renderer.domElement;
  let selectedId = null, recording = false, recordStart = 0, marker = null;
  const now = options.now || (() => performance.now());
  const emit = data => { if (window.parent !== window) window.parent.postMessage(data, location.origin); };
  function context() {
    const scene = options.getScene(), camera = options.getCamera();
    if (!scene || !camera) return null;
    const id = options.getSelected ? options.getSelected() : selectedId;
    const selected = resolveSelection(THREE, scene, camera, id, identify);
    const objects = [];
    scene.traverse(mesh => {
      if (!mesh.isMesh || mesh.userData.frameshiftIgnore || objects.length >= 200) return;
      const meshId = identify(mesh, scene) ?? (mesh.userData.semanticIds?.length ? `group/${mesh.userData.semanticIds[0]}` : null); if (meshId == null) return;
      objects.push({ id: String(meshId), name: mesh.name || mesh.type, type: mesh.type, geometry: mesh.geometry?.type,
        instances: mesh.isInstancedMesh ? mesh.count : 1, semanticIds: mesh.userData.semanticIds?.slice(0, 200) });
    });
    const cameraState = snapshotCamera(camera);
    return { version: 1, selectedId: selected?.id || null, selected, selection: selected, cameraState, camera: cameraState,
      time: Number(options.getTime()) || 0, objects,
      metrics: { calls: options.renderer.info.render.calls, triangles: options.renderer.info.render.triangles, scope: 'whole-frame renderer counters; not selected-object timing' },
      sourceAssociation: null, capabilities: { selection: true, cameraSync: true, recording: true, deterministicTime: Boolean(controlled || options.deterministicTime) } };
  }
  function publish(requestId) { const value = context(); if (value) emit({ type: 'frameshift:context', requestId, context: value }); return value; }
  function select(id) {
    const selection = resolveSelection(THREE, options.getScene(), options.getCamera(), id, identify);
    selectedId = selection?.id || null; options.setSelected?.(selectedId);
    emit({ type: 'frameshift:selection', id: selectedId }); return publish();
  }
  function updateMarker(value) {
    if (controlled || !value?.selected?.anchor.visible) { if (marker) marker.hidden = true; return; }
    if (!marker) { marker = document.createElement('div'); marker.setAttribute('aria-hidden', 'true'); marker.dataset.earlInspector = 'selection'; Object.assign(marker.style, {position:'fixed',pointerEvents:'none',width:'26px',height:'26px',border:'2px solid #efcda2',borderRadius:'50%',boxShadow:'0 0 0 4px #b97b4b33',transform:'translate(-50%,-50%)',zIndex:'2147483646'}); document.body.append(marker); }
    const rect = canvas.getBoundingClientRect(); marker.style.left = `${rect.left + value.selected.anchor.x * rect.width}px`; marker.style.top = `${rect.top + value.selected.anchor.y * rect.height}px`; marker.hidden = false;
  }
  function hit(event) {
    const scene = options.getScene(), camera = options.getCamera(); if (!scene || !camera) return null;
    const rect = canvas.getBoundingClientRect(), ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
    const item = ray.intersectObjects(scene.children, true).find(h => h.object.isMesh && !h.object.userData.frameshiftIgnore && (identify(h.object, scene) != null || h.object.userData.semanticIds));
    if (!item) return null;
    return item.object.isInstancedMesh ? String(item.object.userData.semanticIds?.[item.instanceId] ?? `${identify(item.object, scene)}/instance-${item.instanceId}`) : String(identify(item.object, scene));
  }
  canvas.addEventListener('click', event => { select(hit(event)); updateMarker(context()); }, {capture:true,passive:true});
  if (options.recordInteractions) {
    for (const type of ['click','pointerdown','pointerup','pointermove','keydown','keyup','wheel']) canvas.addEventListener(type, event => {
      if (!recording) return;
      const rect = canvas.getBoundingClientRect();
      emit({type:'frameshift:interaction',event:{type,at:(now()-recordStart)/1000,x:Number.isFinite(event.clientX)?Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)):undefined,y:Number.isFinite(event.clientY)?Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height)):undefined,key:event.key,button:event.button,deltaY:event.deltaY}});
    }, {capture:true,passive:true});
    canvas.tabIndex = canvas.tabIndex < 0 ? 0 : canvas.tabIndex;
  }
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== location.origin || !event.data || typeof event.data !== 'object') return;
    const data = event.data;
    try {
      if (data.type === 'frameshift:context') publish(typeof data.requestId === 'string' ? data.requestId.slice(0,80) : undefined);
      if (data.type === 'frameshift:select' || data.type === 'frameshift:highlight') updateMarker(select(data.id));
      if (data.type === 'frameshift:sync') {
        const cameraState = data.cameraState || data.camera;
        if (!validCamera(cameraState) || !Number.isFinite(data.time) || data.time < 0 || data.time > 86400) throw Error('Invalid synchronized scene state');
        api.pause(); api.step(data.time,0,cameraState); restoreCamera(options.getCamera(),cameraState); options.renderer.render(options.getScene(),options.getCamera()); publish(data.requestId);
      }
      if (data.type === 'frameshift:step') queueMicrotask(() => publish());
      if (data.type === 'frameshift:record-start') { recording = true; recordStart = now(); }
      if (data.type === 'frameshift:record-stop') recording = false;
    } catch(error) { emit({type:'frameshift:error',message:String(error.message).slice(0,300)}); }
  });
  api.spatialContext = context;
  api.spatialSelect = select;
  if (!controlled) setInterval(() => { const value = publish(); updateMarker(value); }, 700);
  return context;
}
