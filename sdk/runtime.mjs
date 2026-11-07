/* FrameShift's observer is injected by its Vite plugin, outside editable project source. */
import * as THREE from "three";
const nativeNow = performance.now.bind(performance);
const nativeRaf = window.requestAnimationFrame.bind(window);
const nativeCancel = window.cancelAnimationFrame.bind(window);
const originalRandom = Math.random,
  originalDateNow = Date.now;
let legacy = false;
const controlled =
  new URLSearchParams(location.search).get("__frameshift") === "1";
let virtualTime = 0,
  paused = controlled,
  pumping = false,
  sequence = 0,
  frameStart = 0,
  currentCpu = 0,
  lastCpu = 0,
  lastRenderCpu = 0,
  selected = null,
  recording = false,
  recordStart = 0;
let seed = 1337;
const random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
if (controlled) {
  Math.random = random;
  Object.defineProperty(performance, "now", {
    configurable: true,
    value: () => virtualTime,
  });
  Date.now = () => 1700000000000 + virtualTime;
}
const pending = new Map();
const observers = [];
const frameTimes = [],
  cpuTimes = [],
  renderTimes = [],
  longTasks = [];
const tail = (a, n = 100) => a.slice(-n);
const emit = (data) => {
  if (window.parent !== window) window.parent.postMessage(data, "*");
};
window.requestAnimationFrame = function (callback) {
  const id = ++sequence;
  if (controlled || paused) {
    pending.set(id, callback);
    return id;
  }
  const real = nativeRaf((timestamp) => {
    pending.delete(id);
    if (paused) {
      pending.set(id, callback);
      return;
    }
    const before = nativeNow();
    frameStart = before;
    currentCpu = 0;
    try {
      callback(timestamp);
    } finally {
      lastCpu = nativeNow() - before;
      cpuTimes.push(lastCpu);
      renderTimes.push(currentCpu);
      if (cpuTimes.length > 150) cpuTimes.shift();
      if (renderTimes.length > 150) renderTimes.shift();
    }
  });
  pending.set(id, { real, callback });
  return id;
};
window.cancelAnimationFrame = function (id) {
  const value = pending.get(id);
  if (value && typeof value === "object") nativeCancel(value.real);
  pending.delete(id);
};
if (PerformanceObserver.supportedEntryTypes?.includes("longtask"))
  new PerformanceObserver((list) => {
    longTasks.push(
      ...list
        .getEntries()
        .map((e) => ({ start: e.startTime, duration: e.duration })),
    );
    if (longTasks.length > 100) longTasks.splice(0, longTasks.length - 100);
  }).observe({ type: "longtask", buffered: true });
function primary() {
  return observers.find((o) => o.scene) || observers[0];
}
function invoke(timestamp) {
  virtualTime = timestamp;
  const batch = [...pending.entries()];
  pending.clear();
  const start = nativeNow();
  currentCpu = 0;
  for (const [id, entry] of batch) {
    const callback = typeof entry === "function" ? entry : entry.callback;
    if (entry.real) nativeCancel(entry.real);
    callback(timestamp);
  }
  lastCpu = nativeNow() - start;
  lastRenderCpu = currentCpu;
  return lastCpu;
}
function resume() {
  paused = false;
  if (controlled) {
    if (pumping) return;
    pumping = true;
    let last;
    const pump = (now) => {
      if (paused) {
        pumping = false;
        return;
      }
      const dt = last == null ? 16.6667 : Math.min(now - last, 50);
      last = now;
      invoke(virtualTime + dt);
      nativeRaf(pump);
    };
    nativeRaf(pump);
  } else {
    const list = [...pending.values()];
    pending.clear();
    for (const entry of list) {
      if (typeof entry === "object") nativeCancel(entry.real);
      window.requestAnimationFrame(
        typeof entry === "function" ? entry : entry.callback,
      );
    }
  }
}
function matrices(observer) {
  if (!observer?.scene) return [];
  observer.scene.updateMatrixWorld(true);
  const result = [];
  const matrix = new THREE.Matrix4();
  observer.scene.traverse((object) => {
    if (!object.isMesh || object.userData.frameshiftIgnore) return;
    const base = objectId(object, observer.scene);
    if (object.isInstancedMesh) {
      for (let i = 0; i < object.count; i++) {
        object.getMatrixAt(i, matrix);
        matrix.premultiply(object.matrixWorld);
        result.push([
          String(object.userData.semanticIds?.[i] ?? `${base}/instance-${i}`),
          ...matrix.elements.map((n) => Number(n.toFixed(5))),
        ]);
      }
    } else
      result.push([
        base,
        ...object.matrixWorld.elements.map((n) => Number(n.toFixed(5))),
      ]);
  });
  return result.sort((a, b) => a[0].localeCompare(b[0]));
}
function objectId(object, scene) {
  if (object.userData.semanticId != null)
    return String(object.userData.semanticId);
  if (object.userData.frameshiftId != null)
    return String(object.userData.frameshiftId);
  if (object.name) return object.name;
  const p = [];
  let o = object;
  while (o && o !== scene) {
    p.push(o.parent?.children.indexOf(o) ?? 0);
    o = o.parent;
  }
  return "scene/" + p.reverse().join("/");
}
function pick(x, y) {
  const o = primary();
  if (!o?.scene || !o.camera) return null;
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(x, y), o.camera);
  const hits = ray
    .intersectObjects(o.scene.children, true)
    .filter((h) => h.object.isMesh && !h.object.userData.frameshiftIgnore);
  if (!hits.length) return null;
  const h = hits[0];
  return h.object.isInstancedMesh
    ? String(
        h.object.userData.semanticIds?.[h.instanceId] ??
          `${objectId(h.object, o.scene)}/instance-${h.instanceId}`,
      )
    : objectId(h.object, o.scene);
}
function inventory() {
  const o = primary();
  if (!o?.scene) return [];
  const result = [];
  o.scene.traverse((mesh) => {
    if (!mesh.isMesh || mesh.userData.frameshiftIgnore) return;
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    result.push({
      id: objectId(mesh, o.scene),
      name: mesh.name || mesh.type,
      type: mesh.type,
      instances: mesh.isInstancedMesh ? mesh.count : 1,
      geometry: mesh.geometry?.type,
      triangles: Math.round(
        (mesh.geometry?.index?.count ??
          mesh.geometry?.attributes?.position?.count ??
          0) / 3,
      ),
      materials: materials.map((m) => m?.name || m?.type),
      position: mesh.getWorldPosition(new THREE.Vector3()).toArray(),
      semanticIds: mesh.userData.semanticIds?.slice(0, 200),
    });
  });
  return result;
}
function interactionState() {
  return {
    selected,
    dom: [
      ...document.querySelectorAll(
        '[aria-selected],[aria-pressed],output,[role="status"],[data-frameshift-check]',
      ),
    ]
      .slice(0, 60)
      .map((e) => ({
        tag: e.tagName,
        label:
          e.getAttribute("aria-label") ||
          e.id ||
          e.getAttribute("data-frameshift-check"),
        selected: e.getAttribute("aria-selected"),
        pressed: e.getAttribute("aria-pressed"),
        text: e.textContent?.trim().slice(0, 240),
      })),
  };
}
function cameraSnapshot(camera) {
  return {
    position: camera.position.toArray(),
    quaternion: camera.quaternion.toArray(),
    projection: camera.projectionMatrix.toArray(),
    up: camera.up.toArray(),
  };
}
function applyCamera(camera, state) {
  if (!state) return;
  if (Array.isArray(state)) {
    camera.position.fromArray(state);
    return;
  }
  if (state.position) camera.position.fromArray(state.position);
  if (state.quaternion) camera.quaternion.fromArray(state.quaternion);
  if (state.up) camera.up.fromArray(state.up);
  if (state.projection) {
    camera.projectionMatrix.fromArray(state.projection);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }
  camera.updateMatrixWorld(true);
}
function positionCamera(o, view, override) {
  if (!o?.camera || !o.scene) return;
  if (!o.initialCamera) o.initialCamera = cameraSnapshot(o.camera);
  if (!o.initialBounds) {
    o.scene.updateMatrixWorld(true);
    o.scene.traverse((mesh) => {
      if (mesh.isInstancedMesh) {
        mesh.computeBoundingBox();
        mesh.computeBoundingSphere();
      }
    });
    const box = new THREE.Box3().setFromObject(o.scene);
    if (!box.isEmpty()) {
      for (const vector of [box.min, box.max])
        for (const axis of ["x", "y", "z"])
          vector[axis] = Math.round(vector[axis] * 10000) / 10000;
      o.initialBounds = box;
    }
  }
  if (override) {
    applyCamera(o.camera, override);
    return;
  }
  if (view === 0) {
    applyCamera(o.camera, o.initialCamera);
    return;
  }
  const box = o.initialBounds;
  if (!box) return;
  const center = box.getCenter(new THREE.Vector3()),
    size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z, 2) * 0.95;
  const views = [
      [1, 0.8, 1],
      [-1, 0.7, 1],
      [0.2, 1.5, 0.3],
      [1, 0.5, -1],
    ],
    v = views[(view - 1) % views.length];
  o.camera.position.set(
    center.x + v[0] * radius,
    center.y + v[1] * radius,
    center.z + v[2] * radius,
  );
  o.camera.lookAt(center);
  o.camera.updateMatrixWorld(true);
}
let forcedCamera = null;
function step(time = 0, view = 0, cameraOverride = null) {
  forcedCamera = null;
  paused = true;
  const target = Math.max(0, time) * 1000;
  if (target + 1 < virtualTime && controlled)
    throw Error(
      "Scenario time must move forward. Use a new page to rewind an application.",
    );
  if (controlled) {
    while (virtualTime + 1000 / 60 < target) invoke(virtualTime + 1000 / 60);
    invoke(target);
  } else invoke(nativeNow());
  const o = primary();
  if (!o?.scene)
    throw Error("The application has not rendered a Three.js scene.");
  positionCamera(o, view, cameraOverride);
  forcedCamera = cameraOverride;
  if (pending.size) invoke(controlled ? target : nativeNow());
  else o.originalRender(o.scene, o.camera);
  forcedCamera = null;
  o.scene.updateMatrixWorld(true);
  return {
    items: matrices(o),
    picks: [
      [-0.5, -0.2],
      [0, 0],
      [0.3, 0.1],
      [0.6, -0.3],
      [-0.2, 0.4],
    ].map(([x, y]) => pick(x, y)),
    calls: o.renderer.info.render.calls,
    triangles: o.renderer.info.render.triangles,
    interactionState: interactionState(),
    camera: o.camera.position.toArray(),
    cameraState: cameraSnapshot(o.camera),
    sdkVersion: "auto-v2.1-fixed-camera",
    time,
  };
}
async function sample(n = 60) {
  paused = true;
  if (!primary()) throw Error("No Three.js renderer observed");
  for (let i = 0; i < 15; i++) {
    await new Promise(nativeRaf);
    invoke(virtualTime + 1000 / 60);
  }
  const frames = [],
    submit = [],
    renderSubmit = [];
  let previous = await new Promise(nativeRaf);
  for (let i = 0; i < n; i++) {
    const now = await new Promise(nativeRaf);
    frames.push(now - previous);
    previous = now;
    submit.push(invoke(virtualTime + 1000 / 60));
    renderSubmit.push(lastRenderCpu);
  }
  const o = primary(),
    gl = o.renderer.getContext(),
    debug = gl.getExtension("WEBGL_debug_renderer_info");
  return {
    frames,
    submit,
    renderSubmit,
    calls: o.renderer.info.render.calls,
    triangles: o.renderer.info.render.triangles,
    geometries: o.renderer.info.memory.geometries,
    textures: o.renderer.info.memory.textures,
    longTasks: tail(longTasks),
    renderer: debug
      ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER),
  };
}
async function gpuSample() {
  const o = primary();
  if (!o?.scene)
    return { supported: false, times: [], reason: "No rendered scene" };
  const gl = o.renderer.getContext(),
    ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  if (!ext)
    return {
      supported: false,
      times: [],
      reason: "GPU disjoint timer queries unavailable",
    };
  const times = [];
  let disjoint = 0;
  for (let i = 0; i < 12; i++) {
    const query = gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    if (pending.size) invoke(virtualTime + 1000 / 60);
    else o.originalRender(o.scene, o.camera);
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    for (let poll = 0; poll < 30; poll++) {
      await new Promise(nativeRaf);
      if (gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
        if (gl.getParameter(ext.GPU_DISJOINT_EXT)) disjoint++;
        else times.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
        break;
      }
    }
    gl.deleteQuery(query);
  }
  return { supported: true, times, disjoint };
}
function telemetry() {
  const o = primary();
  return {
    frames: tail(frameTimes),
    submit: tail(cpuTimes),
    renderSubmit: tail(renderTimes),
    calls: o?.renderer.info.render.calls || 0,
    triangles: o?.renderer.info.render.triangles || 0,
    rendererCount: observers.length,
  };
}
function normalizeEvent(event, canvas) {
  const r = canvas.getBoundingClientRect();
  return {
    type: event.type,
    x: Number.isFinite(event.clientX)
      ? Math.max(0, Math.min(1, (event.clientX - r.left) / r.width))
      : undefined,
    y: Number.isFinite(event.clientY)
      ? Math.max(0, Math.min(1, (event.clientY - r.top) / r.height))
      : undefined,
    key: event.key,
    button: event.button,
    deltaY: event.deltaY,
    at: (nativeNow() - recordStart) / 1000,
  };
}
export function observeRenderer(renderer) {
  if (observers.some((o) => o.renderer === renderer)) return;
  const originalRender = renderer.render.bind(renderer);
  const observed = {
    renderer,
    originalRender,
    scene: null,
    camera: null,
    score: -1,
    seenScenes: new WeakMap(),
  };
  observers.push(observed);
  renderer.render = function (scene, camera) {
    if (forcedCamera && scene === observed.scene)
      applyCamera(camera, forcedCamera);
    const start = nativeNow();
    const result = originalRender(scene, camera);
    currentCpu += nativeNow() - start;
    let meshes = observed.seenScenes.get(scene);
    if (meshes === undefined) {
      meshes = 0;
      scene.traverse?.((o) => {
        if (o.isMesh) meshes++;
      });
      observed.seenScenes.set(scene, meshes);
    }
    if (meshes >= observed.score) {
      observed.scene = scene;
      observed.camera = camera;
      observed.score = meshes;
    }
    return result;
  };
  const canvas = renderer.domElement;
  canvas.tabIndex = canvas.tabIndex < 0 ? 0 : canvas.tabIndex;
  for (const type of [
    "click",
    "pointerdown",
    "pointerup",
    "pointermove",
    "wheel",
  ])
    canvas.addEventListener(
      type,
      (event) => {
        if (type === "click") {
          const r = canvas.getBoundingClientRect();
          selected = pick(
            ((event.clientX - r.left) / r.width) * 2 - 1,
            (-(event.clientY - r.top) / r.height) * 2 + 1,
          );
          emit({ type: "frameshift:selection", id: selected });
        }
        if (recording)
          emit({
            type: "frameshift:interaction",
            event: normalizeEvent(event, canvas),
          });
      },
      { capture: true, passive: true },
    );
  for (const type of ["keydown", "keyup"])
    canvas.addEventListener(type, (event) => {
      if (recording)
        emit({
          type: "frameshift:interaction",
          event: normalizeEvent(event, canvas),
        });
    });
  installApi();
}
function installApi() {
  if (window.__frameshift && window.__frameshift.sdk !== "auto-v2") return;
  window.__frameshift = {
    sdk: "auto-v2",
    ready: true,
    get metadata() {
      return {
        engine: THREE.REVISION,
        backend: "WebGL2",
        pixelRatio: primary()?.renderer.getPixelRatio(),
        controlled,
        rendererCount: observers.length,
        limitations: [
          "CPU measurement covers complete driven animation callbacks.",
          "Scenario clocks/randomness are controlled; applications driven by timers or external state need explicit assertions.",
        ],
      };
    },
    pause() {
      paused = true;
    },
    resume,
    step,
    sample,
    gpuSample,
    telemetry,
    listObjects: inventory,
    pick,
    interactionState,
    select(id) {
      selected = String(id);
      return inventory().find((o) => o.id === selected) || null;
    },
  };
}
function restoreLegacy() {
  if (legacy) return;
  legacy = true;
  paused = false;
  window.requestAnimationFrame = nativeRaf;
  window.cancelAnimationFrame = nativeCancel;
  if (controlled) {
    Object.defineProperty(performance, "now", {
      configurable: true,
      value: nativeNow,
    });
    Date.now = originalDateNow;
    Math.random = originalRandom;
  }
  for (const entry of pending.values())
    nativeRaf(typeof entry === "function" ? entry : entry.callback);
  pending.clear();
}
let previousFrame;
nativeRaf(function clock(now) {
  if (window.__frameshift?.ready && window.__frameshift.sdk !== "auto-v2")
    restoreLegacy();
  if (previousFrame != null) {
    frameTimes.push(now - previousFrame);
    if (frameTimes.length > 150) frameTimes.shift();
  }
  previousFrame = now;
  nativeRaf(clock);
});
window.addEventListener("message", (event) => {
  if (legacy) return;
  if (
    event.source !== window.parent ||
    !["null", location.origin].includes(event.origin)
  )
    return;
  const data = event.data;
  if (data?.type === "frameshift:pause") paused = true;
  if (data?.type === "frameshift:resume") resume();
  if (data?.type === "frameshift:step") {
    try {
      step(data.time, data.view);
    } catch (error) {
      emit({ type: "frameshift:error", message: error.message });
    }
  }
  if (data?.type === "frameshift:select") {
    selected = data.id == null ? null : String(data.id);
    emit({ type: "frameshift:selection", id: selected });
  }
  if (data?.type === "frameshift:record-start") {
    recording = true;
    recordStart = nativeNow();
  }
  if (data?.type === "frameshift:record-stop") recording = false;
  if (data?.type === "frameshift:objects")
    emit({ type: "frameshift:objects", objects: inventory() });
});
setInterval(() => {
  if (legacy || controlled) return;
  emit({ type: "frameshift:telemetry", ...telemetry() });
  if (primary()?.scene)
    emit({ type: "frameshift:objects", objects: inventory().slice(0, 250) });
}, 1000);
