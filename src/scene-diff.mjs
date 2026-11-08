const finiteArray = (a, size) => Array.isArray(a) && (size == null || a.length === size) && a.every(Number.isFinite);
const matrixEqual = (a, b) => a.every((n, i) => Math.abs(n - b[i]) <= 1e-6 * Math.max(1, Math.abs(n), Math.abs(b[i])));

// Treat this as evidence from a bounded rendering snapshot, not CAD part identity.
export function validateSceneSnapshot(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.nodes) || !Array.isArray(value.geometries) || !Array.isArray(value.materials)) throw Error('This build does not expose supported scene geometry.');
  if (value.nodes.length > 10000 || value.geometries.length > 10000 || value.materials.length > 20000) throw Error('Scene snapshot exceeds diagnostic limits.');
  let entries = 0;
  const geometries = new Map(), materials = new Map();
  for (const g of value.geometries) {
    entries += (g.position?.length || 0) + (g.index?.length || 0);
    if (entries > 900000 || typeof g.id !== 'string' || geometries.has(g.id) || !finiteArray(g.position) || !g.position.length || g.position.length % 3 || (g.index != null && (!Array.isArray(g.index) || !g.index.every(i => Number.isInteger(i) && i >= 0 && i < g.position.length / 3)))) throw Error('Scene geometry is incomplete or exceeds diagnostic limits.');
    geometries.set(g.id, g);
  }
  for (const m of value.materials) {
    if (typeof m.id !== 'string' || materials.has(m.id) || !finiteArray(m.color, 3)) throw Error('Scene material is unsupported.');
    materials.set(m.id, m);
  }
  const keys = new Set();
  for (const n of value.nodes) {
    if (typeof n.key !== 'string' || keys.has(n.key) || !geometries.has(n.geometryId) || !materials.has(n.materialId) || !finiteArray(n.matrix, 16)) throw Error('Scene object references are incomplete.');
    keys.add(n.key);
  }
  return { ...value, geometriesById: geometries, materialsById: materials };
}

const geometrySignature = g => JSON.stringify([g.position, g.index || null]);
const materialSignature = m => JSON.stringify([m.color, m.opacity ?? 1, Boolean(m.transparent), m.roughness ?? 1, m.metalness ?? 0, m.side ?? 0]);

export function diffSceneSnapshots(beforeValue, afterValue) {
  const before = validateSceneSnapshot(beforeValue), after = validateSceneSnapshot(afterValue);
  // IDs are normally content hashes; compare the payload as well so equal IDs
  // never hide geometry changes in an older or third-party adapter.
  const signatures = snapshot => ({
    geometry: new Map(snapshot.geometries.map(g => [g.id, geometrySignature(g)])),
    material: new Map(snapshot.materials.map(m => [m.id, materialSignature(m)])),
  });
  const bs = signatures(before), as = signatures(after);
  const semanticCounts = snapshot => {
    const result = new Map();
    snapshot.nodes.forEach(n => n.semanticId != null && result.set(String(n.semanticId), (result.get(String(n.semanticId)) || 0) + 1));
    return result;
  };
  const bc = semanticCounts(before), ac = semanticCounts(after);
  const identity = n => n.semanticId != null && bc.get(String(n.semanticId)) === 1 && ac.get(String(n.semanticId)) === 1 ? `semantic:${n.semanticId}` : `key:${n.key}`;
  const available = new Map(after.nodes.map(n => [identity(n), n]));
  const used = new Set(), pairs = [], removed = [];
  const appearance = (n, s) => s.geometry.get(n.geometryId) + '|' + s.material.get(n.materialId);
  // Structural key changes (for example instancing) may erase path identities.
  // Exact appearance+world matrix is a safe fallback for visual correspondence.
  const fallback = new Map();
  for (const n of after.nodes) {
    const k = appearance(n, as); if (!fallback.has(k)) fallback.set(k, []); fallback.get(k).push(n);
  }
  for (const oldNode of before.nodes) {
    let newNode = available.get(identity(oldNode));
    if (newNode && used.has(newNode)) newNode = null;
    if (!newNode) newNode = fallback.get(appearance(oldNode, bs))?.find(n => !used.has(n) && (oldNode.semanticId == null || n.semanticId == null) && matrixEqual(oldNode.matrix, n.matrix));
    if (!newNode) { removed.push(oldNode); continue; }
    used.add(newNode);
    pairs.push({ before: oldNode, after: newNode, moved: !matrixEqual(oldNode.matrix, newNode.matrix), geometryChanged: bs.geometry.get(oldNode.geometryId) !== as.geometry.get(newNode.geometryId), materialChanged: bs.material.get(oldNode.materialId) !== as.material.get(newNode.materialId), regrouped: false });
  }
  const added = after.nodes.filter(n => !used.has(n));
  const pairIdentity = new Map(); pairs.forEach((p, i) => { pairIdentity.set(p.before, i); pairIdentity.set(p.after, i); });
  function memberships(snapshot) {
    const groups = new Map();
    for (const n of snapshot.nodes) { if (!groups.has(n.batchId)) groups.set(n.batchId, []); groups.get(n.batchId).push(pairIdentity.has(n) ? pairIdentity.get(n) : 'unmatched:' + n.key); }
    const kinds = new Map((snapshot.batches || []).map(b => [b.id, b.kind]));
    return new Map([...groups].map(([id, nodes]) => [id, (kinds.get(id) || 'mesh') + ':' + nodes.sort((a, b) => String(a).localeCompare(String(b))).join(',')]));
  }
  const bm = memberships(before), am = memberships(after);
  for (const pair of pairs) pair.regrouped = bm.get(pair.before.batchId) !== am.get(pair.after.batchId);
  const warnings = [...new Set([...(before.warnings || []), ...(after.warnings || [])].map(String))];
  if (before.truncated || after.truncated) warnings.unshift('Partial geometry snapshot: changes outside the captured geometry are not shown.');
  if (pairs.some(p => p.before.semanticId == null || p.after.semanticId == null)) warnings.push('Some objects are matched by rendering structure or exact appearance, not semantic part identity.');
  return { before, after, pairs, removed, added, warnings, partial: Boolean(before.truncated || after.truncated), counts: { unchanged: pairs.filter(p => !p.moved && !p.geometryChanged && !p.materialChanged && !p.regrouped).length, moved: pairs.filter(p => p.moved).length, modified: pairs.filter(p => p.geometryChanged || p.materialChanged).length, regrouped: pairs.filter(p => p.regrouped).length, added: added.length, removed: removed.length }, timeMatched: Number.isFinite(before.time) && Number.isFinite(after.time) && Math.abs(before.time - after.time) < 1e-6 };
}
