import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { diffSceneSnapshots } from './scene-diff.mjs';
import './live-scene.css';

const controlledUrl = url => { const u = new URL(url, window.location.origin); u.searchParams.set('__frameshift', '1'); return u.pathname + u.search; };
const sceneApi = frame => { try { return frame?.contentWindow?.__frameshift; } catch { return null; } };
function pause(frame) { try { sceneApi(frame)?.pause?.(); frame?.contentWindow?.postMessage({ type: 'frameshift:pause' }, window.location.origin); } catch {} }
function waitForScene(frame, signal, requireSnapshot = false, expectedUrl = null) {
  return new Promise((resolve, reject) => {
    let timer; const start = Date.now();
    const stop = () => { clearTimeout(timer); frame?.removeEventListener('load', poll); signal?.removeEventListener('abort', abort); };
    const abort = () => { stop(); reject(new DOMException('Scene request cancelled', 'AbortError')); };
    const poll = () => {
      clearTimeout(timer);
      if (signal?.aborted) return abort();
      let navigated = true;
      try { navigated = !expectedUrl || frame?.contentWindow?.location.href === new URL(expectedUrl, window.location.origin).href; } catch { navigated = false; }
      const api = navigated ? sceneApi(frame) : null;
      if (api?.ready && (!requireSnapshot || typeof api.sceneSnapshot === 'function')) { stop(); resolve(api); return; }
      if (Date.now() - start > 15000 || requireSnapshot && api?.ready && Date.now() - start > 2000) { stop(); reject(Error(requireSnapshot ? 'This build has no geometry snapshot bridge. The running app is still available in Live.' : 'Scene controls are unavailable for this build. You can still interact with the app.')); return; }
      timer = setTimeout(poll, 120);
    };
    frame?.addEventListener('load', poll); signal?.addEventListener('abort', abort, { once: true }); poll();
  });
}

function ChangesScene({ diff, measuring, color }) {
  const host = useRef(null), live = useRef({ measuring }); live.current.measuring = measuring;
  const [mix, setMix] = useState(1), [batchView, setBatchView] = useState(false), [error, setError] = useState('');
  const control = useRef({ mix: 1, batchView: false }); control.current = { mix, batchView };
  useEffect(() => {
    const el = host.current; if (!el || !diff) return;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true }); }
    catch { setError('The geometry comparison renderer is unavailable. Open Live to inspect the actual app.'); return; }
    setError(''); renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setClearColor('#101219'); el.append(renderer.domElement);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(38, 1, .001, 1e9);
    scene.add(new THREE.HemisphereLight('#ffffff', '#505470', 2.5));
    const light = new THREE.DirectionalLight('#ffffff', 3); light.position.set(2, 3, 4); scene.add(light);
    const geometries = new Map(), materials = [], groups = new Map(), owned = [];
    function geometry(snapshot, id, prefix) {
      const key = prefix + id; if (geometries.has(key)) return geometries.get(key);
      const source = snapshot.geometriesById.get(id), g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(source.position, 3)); if (source.index) g.setIndex(source.index);
      g.computeVertexNormals(); geometries.set(key, g); return g;
    }
    const rows = [];
    for (const pair of diff.pairs) {
      if (pair.geometryChanged || pair.materialChanged) rows.push({ node: pair.before, snapshot: diff.before, prefix: 'old:', style: 'removed' });
      rows.push({ node: pair.after, old: pair.before, snapshot: diff.after, prefix: 'new:', style: pair.geometryChanged || pair.materialChanged ? 'added' : pair.moved ? 'moved' : 'base', regrouped: pair.regrouped, moved: pair.moved });
    }
    diff.removed.forEach(node => rows.push({ node, snapshot: diff.before, prefix: 'old:', style: 'removed' }));
    diff.added.forEach(node => rows.push({ node, snapshot: diff.after, prefix: 'new:', style: 'added' }));
    for (const row of rows) {
      const k = [row.prefix, row.node.geometryId, row.node.materialId, row.style, row.regrouped ? 'regrouped' : ''].join('|');
      if (!groups.has(k)) groups.set(k, []); groups.get(k).push(row);
    }
    const box = new THREE.Box3(), matrix = new THREE.Matrix4(), tempBox = new THREE.Box3();
    for (const list of groups.values()) {
      const row = list[0], g = geometry(row.snapshot, row.node.geometryId, row.prefix), source = row.snapshot.materialsById.get(row.node.materialId), actual = new THREE.Color().fromArray(source.color);
      const mat = new THREE.MeshStandardMaterial({ color: actual, roughness: Math.max(.15, Math.min(1, source.roughness ?? .65)), metalness: Math.max(0, Math.min(1, source.metalness ?? 0)), side: THREE.DoubleSide, transparent: row.style === 'removed' || Boolean(source.transparent), opacity: row.style === 'removed' ? .24 : Math.max(0, Math.min(1, source.opacity ?? 1)), depthWrite: row.style !== 'removed' });
      materials.push(mat);
      const mesh = new THREE.InstancedMesh(g, mat, list.length); mesh.frustumCulled = false; mesh.renderOrder = row.style === 'removed' ? 1 : 0;
      list.forEach((item, i) => { matrix.fromArray(item.node.matrix); mesh.setMatrixAt(i, matrix); if (!g.boundingBox) g.computeBoundingBox(); tempBox.copy(g.boundingBox).applyMatrix4(matrix); box.union(tempBox); if (item.old) { tempBox.copy(g.boundingBox).applyMatrix4(new THREE.Matrix4().fromArray(item.old.matrix)); box.union(tempBox); } });
      mesh.instanceMatrix.needsUpdate = true; scene.add(mesh); owned.push({ mesh, list, actual, row });
    }
    if (box.isEmpty()) { geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); renderer.dispose(); renderer.domElement.remove(); setError('No supported mesh geometry was captured. Open Live for the actual application.'); return; }
    const center = box.getCenter(new THREE.Vector3()), radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, .000001);
    const controls = new OrbitControls(camera, renderer.domElement); controls.target.copy(center); controls.enableDamping = false;
    camera.near = Math.max(radius / 10000, 1e-9); camera.far = radius * 1000;
    camera.position.copy(center).add(new THREE.Vector3(radius * 1.5, radius, radius * 2.2)); camera.lookAt(center);
    let dirty = true, lastMix = -1, lastBatches = null, raf;
    const resize = () => { const w = el.clientWidth || 600, h = el.clientHeight || 450; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); dirty = true; };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();
    controls.addEventListener('change', () => { dirty = true; });
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), op = new THREE.Vector3(), oq = new THREE.Quaternion(), os = new THREE.Vector3();
    function tick() {
      raf = requestAnimationFrame(tick); if (live.current.measuring) return;
      const state = control.current;
      if (lastMix !== state.mix || lastBatches !== state.batchView) {
        for (const { mesh, list, actual, row } of owned) {
          const tint = row.style === 'removed' ? '#f37783' : row.style === 'added' ? '#71e6aa' : row.style === 'moved' ? '#eec66b' : state.batchView && row.regrouped ? color || '#a999ff' : null;
          mesh.material.color.copy(actual); if (tint) mesh.material.color.lerp(new THREE.Color(tint), row.style === 'base' ? .65 : .72);
          list.forEach((item, i) => {
            matrix.fromArray(item.node.matrix);
            if (item.old && item.moved) { matrix.decompose(p, q, s); new THREE.Matrix4().fromArray(item.old.matrix).decompose(op, oq, os); p.lerpVectors(op, p, state.mix); q.slerpQuaternions(oq, q.clone(), state.mix); s.lerpVectors(os, s, state.mix); matrix.compose(p, q, s); }
            mesh.setMatrixAt(i, matrix);
          }); mesh.instanceMatrix.needsUpdate = true;
        }
        lastMix = state.mix; lastBatches = state.batchView; dirty = true;
      }
      if (dirty) { renderer.render(scene, camera); dirty = false; }
    }
    tick();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); owned.forEach(o => o.mesh.dispose()); renderer.dispose(); renderer.domElement.remove(); };
  }, [diff, color]);
  return <div className="ls-changes"><div className="ls-geometry" ref={host} />{error && <p className="ls-notice">{error}</p>}<div className="ls-diff-tools"><span><i className="ls-dot ls-green" /> Added / changed</span><span><i className="ls-dot ls-red" /> Previous / removed</span>{diff.counts.moved > 0 && <label>Move <input aria-label="Interpolate actual moved objects" type="range" min="0" max="1" step=".01" value={mix} onChange={e => setMix(Number(e.target.value))} /></label>}{diff.counts.regrouped > 0 && <button aria-pressed={batchView} onClick={() => setBatchView(v => !v)}>Highlight regrouped objects</button>}</div></div>;
}

export default function LiveScene({ project, run, experiment, measuring = false, color = '#a999ff' }) {
  const [mode, setMode] = useState('live'), [ready, setReady] = useState(false), [notice, setNotice] = useState(''), [diff, setDiff] = useState(null), [captureError, setCaptureError] = useState(''), [receipt, setReceipt] = useState(null);
  const frame = useRef(null), original = useRef(null), candidate = useRef(null), sync = useRef(null), measuringRef = useRef(measuring); measuringRef.current = measuring;
  const exp = experiment || [...(run?.experiments || [])].reverse().find(e => e.previewReady && e.previewUrl);
  const currentUrl = project?.id && Boolean(project?.built) ? `/preview/${encodeURIComponent(project.id)}/index.html` : null;
  const baselineUrl = project?.id ? `/baseline/${encodeURIComponent(project.id)}/index.html` : null;
  const candidateUrl = exp?.previewReady && typeof exp.previewUrl === 'string' && exp.previewUrl.startsWith('/candidate/') ? exp.previewUrl : null;
  const src = mode === 'original' ? baselineUrl : mode === 'candidate' ? candidateUrl : currentUrl;
  useEffect(() => { setMode('live'); setDiff(null); setNotice(''); sync.current = null; }, [project?.id]);
  useEffect(() => {
    setReceipt(null); if (!run?.id || !exp?.id) return;
    const abort = new AbortController(); let timer;
    async function load() { try { const r = await fetch(`/api/runs/${encodeURIComponent(run.id)}/experiments/${encodeURIComponent(exp.id)}/verdict`, { signal: abort.signal, cache: 'no-store' }); if (r.ok) { const data = await r.json(); if (data.policyHash && data.evaluatedAt && data.verdict?.status) { setReceipt(data); return; } } } catch {} if (!abort.signal.aborted) timer = setTimeout(load, 2500); }
    load(); return () => { abort.abort(); clearTimeout(timer); };
  }, [run?.id, exp?.id, exp?.status]);
  useEffect(() => {
    if (!src) return;
    const abort = new AbortController(); setReady(false); setNotice('');
    waitForScene(frame.current, abort.signal, false, src).then(api => {
      if (measuringRef.current || mode === 'changes') { pause(frame.current); setReady(true); return; }
      if (sync.current && api.spatialContext && api.step) { try { api.pause?.(); api.step(sync.current.time, 0, sync.current.cameraState); api.resume?.(); } catch { setNotice('This build could not restore the previous camera and time.'); } }
      setReady(true);
    }).catch(e => e.name !== 'AbortError' && setNotice(e.message));
    return () => abort.abort();
  }, [src]);
  useEffect(() => {
    for (const f of [frame.current, original.current, candidate.current]) if (measuring || mode === 'changes' || f !== frame.current) pause(f);
    if (!measuring && mode !== 'changes') { try { sceneApi(frame.current)?.resume?.(); } catch {} }
  }, [measuring, mode, ready]);
  useEffect(() => {
    if (mode !== 'changes' || measuring || !candidateUrl || !baselineUrl) return;
    const abort = new AbortController(); setDiff(null); setCaptureError('');
    Promise.all([waitForScene(original.current, abort.signal, true, controlledUrl(baselineUrl)), waitForScene(candidate.current, abort.signal, true, controlledUrl(candidateUrl))]).then(([a, b]) => {
      if (abort.signal.aborted || measuringRef.current) return;
      const time = Number.isFinite(sync.current?.time) ? sync.current.time : 0;
      let cameraState = sync.current?.cameraState;
      if (!cameraState) { try { cameraState = a.spatialContext?.()?.cameraState; } catch {} }
      a.pause?.(); b.pause?.(); a.step?.(time, 0, cameraState); b.step?.(time, 0, cameraState);
      if (abort.signal.aborted || measuringRef.current) return;
      setDiff(diffSceneSnapshots(a.sceneSnapshot(), b.sceneSnapshot()));
    }).catch(e => e.name !== 'AbortError' && setCaptureError(e.message));
    return () => abort.abort();
  }, [mode, candidateUrl, baselineUrl, measuring]);
  const selectMode = next => { try { const c = sceneApi(frame.current)?.spatialContext?.(); if (c?.cameraState && Number.isFinite(c.time)) sync.current = { cameraState: c.cameraState, time: c.time }; } catch {} setMode(next); };
  const status = receipt?.verdict.status === 'accepted' ? 'Verified' : receipt?.verdict.status === 'rejected' || exp?.status === 'rejected' ? 'Rejected' : receipt?.verdict.status === 'inconclusive' ? 'Inconclusive' : 'Testing';
  return <section className="live-scene" aria-label="Interactive project scene" style={{ '--ls-accent': color }}>
    <div className="ls-toolbar"><div className="ls-modes" aria-label="Scene view">{[['live', 'Live'], ['original', 'Original'], ['candidate', 'Candidate'], ['changes', 'Changes']].map(([id, label]) => <button key={id} disabled={(id === 'candidate' || id === 'changes') && !candidateUrl || id === 'original' && !run} aria-pressed={mode === id} onClick={() => selectMode(id)}>{label}</button>)}</div><span className="ls-state">{measuring ? 'Paused for measurement' : mode === 'candidate' || mode === 'changes' ? status : 'Running project'}</span></div>
    <div className="ls-viewport">
      {currentUrl ? <iframe ref={frame} src={src || currentUrl} title={`${project?.name || 'Project'} — ${mode === 'original' ? 'original' : mode === 'candidate' ? 'candidate' : 'interactive app'}`} className={mode === 'changes' ? 'ls-app ls-inactive' : 'ls-app'} onLoad={() => { if (measuringRef.current || mode === 'changes') pause(frame.current); }} /> : <p className="ls-notice">Connect and build a project to open its actual 3D app.</p>}
      {mode === 'changes' && candidateUrl && <><iframe className="ls-capture" ref={original} src={controlledUrl(baselineUrl)} title="Controlled original geometry capture" aria-hidden="true" tabIndex={-1} /><iframe className="ls-capture" ref={candidate} src={controlledUrl(candidateUrl)} title="Controlled candidate geometry capture" aria-hidden="true" tabIndex={-1} />{diff ? <ChangesScene diff={diff} measuring={measuring} color={color} /> : <div className="ls-capture-status"><p>{measuring ? 'Comparison paused while benchmarks run.' : captureError || 'Reading actual geometry from both builds…'}</p>{captureError && <button onClick={() => selectMode('live')}>Return to running app</button>}</div>}</>}
      {notice && mode !== 'changes' && <p className="ls-inline-notice">{notice}</p>}
    </div>
    {mode === 'changes' && diff ? <div className="ls-evidence"><div className="ls-counts"><b>Actual rendering changes</b><span>{diff.counts.added} added · {diff.counts.removed} removed · {diff.counts.moved} moved · {diff.counts.modified} modified · {diff.counts.regrouped} regrouped</span><span>Whole-frame draw calls: {diff.before.counts?.drawCalls ?? diff.before.batches?.length ?? '?'} → {diff.after.counts?.drawCalls ?? diff.after.batches?.length ?? '?'}</span></div><p>{diff.timeMatched ? `Both captures at ${diff.before.time.toFixed(2)}s.` : 'The adapter could not confirm matching simulation times.'} This diagnostic uses captured mesh geometry; open Live for application interactions. Rendering groups do not establish CAD part identity.</p>{diff.warnings.length > 0 && <details><summary>{diff.partial ? 'Partial snapshot' : 'Snapshot scope'} · {diff.warnings.length} notices</summary>{diff.warnings.map((warning, i) => <p key={i}>{warning}</p>)}</details>}</div> : <p className="ls-caption">{project?.name || 'Your project'} <span>· {!currentUrl ? 'Waiting for first build' : mode === 'original' ? 'Baseline build' : mode === 'candidate' ? 'Runnable candidate' : 'Actual interactive application'}</span></p>}
  </section>;
}
