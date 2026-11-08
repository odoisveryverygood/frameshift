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
// Snapshot IDs describe content, never runtime UUIDs. Collision buckets still compare full content.
function snapshotHash(text) {
  let a = 2166136261, b = 2246822519;
  for (let i = 0; i < text.length; i++) {
    const n = text.charCodeAt(i);
    a = Math.imul(a ^ n, 16777619); b = Math.imul(b ^ n, 3266489917);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
export function validSnapshotRequestId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(value);
}
/** Read-only, explicitly requested geometry capture. Unsupported features are omitted, never approximated. */
export function captureSceneSnapshot(THREE, { scene, renderer, camera, identify, time = 0, limits = {} } = {}) {
  if (!scene?.isObject3D) throw Error('The application scene is not ready.');
  const limit = (key, fallback, max) => Number.isInteger(limits[key]) && limits[key] > 0 ? Math.min(limits[key], max) : fallback;
  const maxNodes = limit('maxNodes', 10000, 10000), maxGeometryFloats = limit('maxGeometryFloats', 450000, 450000);
  const maxOutputBytes = Math.max(1024, limit('maxOutputBytes', 16 * 1024 * 1024, 16 * 1024 * 1024));
  const encoder = new TextEncoder();
  const recordSize = value => encoder.encode(JSON.stringify(value)).byteLength + 1;
  const snapshot = { version: 1, time: Number.isFinite(time) ? time : 0, counts: { drawCalls: 0, instances: 0, meshes: 0, triangles: 0 }, geometries: [], materials: [], nodes: [], batches: [], truncated: false, warnings: [] };
  const content = new Map(), geometryCache = new WeakMap(), seenKeys = new Map(), geometryById = new Map(), batchIds = new Set();
  let entries = 0, examinedEntries = 0, bytes = 1024, visited = 0;
  function warn(message, truncated = false) {
    if (truncated) snapshot.truncated = true;
    if (snapshot.warnings.length < 32 && !snapshot.warnings.includes(message)) {
      const warning = message.slice(0, 240), size = recordSize(warning);
      if (bytes + size <= maxOutputBytes) { snapshot.warnings.push(warning); bytes += size; }
    }
  }
  function reserve(value) { const size = recordSize(value); if (bytes + size > maxOutputBytes) { warn('Output byte budget reached; omitted records are not represented by substitute geometry.', true); return false; } bytes += size; return true; }
  function intern(kind, value, target) {
    const text = JSON.stringify(value), hash = snapshotHash(text), base = `${kind}-${hash}`;
    const bucket = content.get(base) || [];
    const equal = bucket.find(item => item.text === text); if (equal) return equal.id;
    const id = bucket.length ? `${base}-${bucket.length}` : base;
    const record = { id, ...value }; if (!reserve(record)) return null;
    bucket.push({ text, id }); content.set(base, bucket); target.push(record); return id;
  }
  function geometryId(geometry) {
    if (geometryCache.has(geometry)) return geometryCache.get(geometry);
    const position = geometry?.attributes?.position, index = geometry?.index;
    if (!position || position.itemSize < 3 || position.normalized || !Number.isInteger(position.count) || position.count * 3 > maxGeometryFloats) { warn('Missing, normalized or over-budget position geometry was skipped.', true); return null; }
    const total = index ? index.count : position.count;
    const start = geometry.drawRange?.start ?? 0, requested = geometry.drawRange?.count ?? Infinity;
    if (!Number.isInteger(start) || start < 0 || !(requested === Infinity || Number.isInteger(requested) && requested >= 0)) { warn('Invalid geometry draw range was skipped.', true); return null; }
    const count = Math.min(total - start, requested);
    if (count <= 0) return null;
    if (start % 3 || count % 3 || index && count + position.count * 3 > maxGeometryFloats) { warn('Unsupported non-triangle or over-budget geometry was skipped.', true); return null; }
    const examining = (index ? position.count * 3 + count : count * 3);
    if (examinedEntries + examining > 4500000) { warn('Geometry inspection work budget reached; remaining geometry was skipped.', true); return null; }
    examinedEntries += examining;
    // Non-indexed draw ranges can be sliced without changing positions or connectivity.
    const first = index ? 0 : start, last = index ? position.count : start + count, values = [];
    for (let i = first; i < last; i++) for (let axis = 0; axis < 3; axis++) {
      const value = axis === 0 ? position.getX(i) : axis === 1 ? position.getY(i) : position.getZ(i);
      if (!Number.isFinite(value)) { warn('Non-finite position geometry was skipped.', true); return null; } values.push(value);
    }
    const indices = index ? [] : null;
    if (index) for (let i = start; i < start + count; i++) {
      const value = index.getX(i); if (!Number.isInteger(value) || value < 0 || value >= position.count) { warn('Invalid geometry indices were skipped.', true); return null; } indices.push(value);
    }
    const value = { position: values, index: indices }, text = JSON.stringify(value), base = `geometry-${snapshotHash(text)}`;
    const equal = content.get(base)?.find(item => item.text === text);
    if (!equal && entries + values.length + (indices?.length || 0) > maxGeometryFloats) { warn('Geometry entry budget reached; remaining distinct geometry was skipped.', true); return null; }
    const id = intern('geometry', value, snapshot.geometries);
    if (id) { if (!equal) entries += values.length + (indices?.length || 0); geometryCache.set(geometry, id); geometryById.set(id, value); }
    return id;
  }
  function materialValue(material, instanceColor) {
    const color = material.color;
    if (!color?.isColor || material.isShaderMaterial || material.isRawShaderMaterial || material.isMeshNormalMaterial || material.wireframe) return null;
    if (Object.keys(material).some(key => /Map$|^map$/.test(key) && material[key]?.isTexture) || material.vertexColors || material.clippingPlanes?.length || material.displacementMap) return null;
    const rgb = [color.r, color.g, color.b].map((v, i) => v * (instanceColor ? [instanceColor.r, instanceColor.g, instanceColor.b][i] : 1));
    const value = { color: rgb, opacity: material.opacity ?? 1, transparent: Boolean(material.transparent), roughness: material.roughness ?? 1, metalness: material.metalness ?? 0, side: material.side ?? 0 };
    if (![...rgb, value.opacity, value.roughness, value.metalness, value.side].every(Number.isFinite)) return null;
    return value;
  }
  scene.updateMatrixWorld(true);
  const stack = [scene], instanceMatrix = new THREE.Matrix4(), worldMatrix = new THREE.Matrix4(), instanceColor = new THREE.Color();
  while (stack.length) {
    const mesh = stack.pop(); if (++visited > 50000) { warn('Scene traversal budget reached.', true); break; }
    if (!mesh.visible || mesh.userData?.frameshiftIgnore) continue;
    // Bound traversal storage as well as output; no unbounded spread of a large scene.
    for (let i = mesh.children.length - 1; i >= 0; i--) {
      if (stack.length >= 50000) { warn('Scene traversal budget reached.', true); break; } stack.push(mesh.children[i]);
    }
    if (mesh.isLine || mesh.isPoints || mesh.isSprite) warn('Line, point or sprite geometry was skipped; the snapshot represents supported triangle meshes only.', true);
    if (!mesh.isMesh || camera && !camera.layers.test(mesh.layers)) continue;
    if (snapshot.nodes.length >= maxNodes) { warn('Node budget reached; remaining meshes or instances were skipped.', true); break; }
    if (mesh.isSkinnedMesh || mesh.isBatchedMesh || mesh.geometry?.isInstancedBufferGeometry || Object.keys(mesh.geometry?.morphAttributes || {}).length || Array.isArray(mesh.material)) { warn('Skinned, batched, custom-instanced, morph-target or multi-material meshes were skipped.', true); continue; }
    if (!mesh.material?.visible) continue;
    const baseMaterial = materialValue(mesh.material);
    if (!baseMaterial) { warn('Shader, textured, wireframe, vertex-colored or otherwise unsupported material was skipped.', true); continue; }
    const geometry = geometryId(mesh.geometry); if (!geometry) continue;
    const baseId = intern('material', baseMaterial, snapshot.materials); if (!baseId) continue;
    const count = mesh.isInstancedMesh ? mesh.count : 1;
    if (!Number.isInteger(count) || count < 0) { warn('Invalid instance count was skipped.', true); continue; }
    let identified = null;
    try { identified = identify?.(mesh, scene) ?? mesh.userData?.semanticId ?? null; } catch { warn('An object identification callback failed; its semantic identity is unavailable.'); }
    const semantics = mesh.userData?.semanticIds;
    const batchNodes = [], batch = { id: '', kind: mesh.isInstancedMesh ? 'instanced' : 'mesh', instances: 0, geometryId: geometry, materialId: baseId };
    for (let i = 0; i < count; i++) {
      if (snapshot.nodes.length + batchNodes.length >= maxNodes) { warn('Node budget reached; remaining instances were skipped.', true); break; }
      if (mesh.isInstancedMesh) { mesh.getMatrixAt(i, instanceMatrix); worldMatrix.multiplyMatrices(mesh.matrixWorld, instanceMatrix); } else worldMatrix.copy(mesh.matrixWorld);
      const matrix = worldMatrix.toArray(); if (!matrix.every(Number.isFinite)) { warn('A non-finite world transform was skipped.', true); continue; }
      let materialId = baseId;
      if (mesh.isInstancedMesh && mesh.instanceColor) {
        mesh.getColorAt(i, instanceColor); const value = materialValue(mesh.material, instanceColor);
        if (!value) { warn('A non-finite instance color was skipped.', true); continue; } materialId = intern('material', value, snapshot.materials); if (!materialId) break;
      }
      const rawSemantic = mesh.isInstancedMesh ? semantics?.[i] : identified;
      const semanticId = rawSemantic == null ? null : String(rawSemantic).slice(0, 160);
      const baseKey = semanticId == null ? `node-${snapshotHash(JSON.stringify([geometry, materialId, matrix]))}` : `semantic:${semanticId}`;
      const occurrence = seenKeys.get(baseKey) || 0, key = occurrence ? `${baseKey}#${occurrence}` : baseKey;
      const node = { key, geometryId: geometry, materialId, matrix, semanticId, batchId: '' };
      // Reserve final ID space now, so the eventual record does not overrun the byte cap.
      if (!reserve({ ...node, batchId: 'batch-ffffffffffffffff-10000' })) break;
      seenKeys.set(baseKey, occurrence + 1); batchNodes.push(node);
    }
    if (!batchNodes.length) continue;
    batch.id = `batch-${snapshotHash(JSON.stringify([geometry, baseId, batchNodes.map(n => n.key)]))}`;
    if (batchIds.has(batch.id)) batch.id += `-${snapshot.batches.length}`;
    batch.instances = batchNodes.length;
    if (!reserve(batch)) continue;
    for (const node of batchNodes) { node.batchId = batch.id; snapshot.nodes.push(node); }
    snapshot.batches.push(batch); batchIds.add(batch.id); snapshot.counts.meshes++; if (mesh.isInstancedMesh) snapshot.counts.instances += batchNodes.length;
    const capturedGeometry = geometryById.get(geometry);
    snapshot.counts.triangles += ((capturedGeometry.index?.length ?? capturedGeometry.position.length / 3) / 3) * batchNodes.length;
  }
  const calls = renderer?.info?.render?.calls;
  snapshot.counts.drawCalls = Number.isFinite(calls) && calls >= 0 ? calls : snapshot.batches.length;
  if (snapshot.truncated) warn('Counts for meshes, instances and triangles cover captured geometry only; drawCalls is the renderer whole-frame counter.');
  if (snapshot.nodes.length) warn('Geometry and listed surface values are captured; lighting, shadows, textures, custom shaders and postprocessing are not reconstructed.');
  return snapshot;
}

export function installSpatialBridge(THREE, options) {
  const api = options.api;
  let benchmarkDepth = 0;
  const sceneSnapshot = () => {
    if (benchmarkDepth || options.isBenchmarking?.()) throw Error("Scene snapshot is unavailable during active benchmarks.");
    return captureSceneSnapshot(THREE, {scene:options.getScene(),camera:options.getCamera(),renderer:options.renderer,identify:options.identify,time:options.getTime(),limits:options.snapshotLimits});
  };
  if (api.spatialContext) return api.spatialContext;
  for (const method of ["sample", "gpuSample"]) {
    if (typeof api[method] !== "function") continue;
    const original = api[method];
    api[method] = async function (...args) { benchmarkDepth++; try { return await original.apply(this,args); } finally { benchmarkDepth--; } };
  }
  api.sceneSnapshot = sceneSnapshot;
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
      if (data.type === 'frameshift:scene-snapshot') {
        if (!validSnapshotRequestId(data.requestId)) return;
        try { emit({type:'frameshift:scene-snapshot-result',requestId:data.requestId,snapshot:sceneSnapshot()}); }
        catch (error) { emit({type:'frameshift:scene-snapshot-result',requestId:data.requestId,error:String(error.message).slice(0,300)}); }
        return;
      }
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
