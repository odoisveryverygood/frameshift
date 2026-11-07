import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {MeshBVH,acceleratedRaycast} from 'three-mesh-bvh';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  Focus,
  Loader2,
  RotateCcw,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import "./robot-repair.css";

const EMPTY = () => Array.from({ length: 3 }, () => [null, null, null]);
const finitePoint = (value) =>
  Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const inBox = (p, b) => p.every((n, i) => n >= b.min[i] && n <= b.max[i]);
const validBounds = (b) =>
  b &&
  finitePoint(b.min) &&
  finitePoint(b.max) &&
  b.min.every((n, i) => n < b.max[i]);
const compact = (n) =>
  Number.isFinite(n) ? Number(n.toPrecision(6)).toLocaleString() : "—";
async function api(url, body, signal) {
  const res = await fetch(
    url,
    body === undefined
      ? { signal }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal,
        },
  );
  const data = await res.json();
  if (!res.ok) throw Error(data.error || `Request failed (${res.status})`);
  return data;
}
async function loadCandidatePositions(candidate, signal) {
  if (
    typeof candidate.previewPositionsUrl !== "string" ||
    !candidate.previewPositionsUrl.startsWith("/") ||
    candidate.previewPositionsUrl.startsWith("//")
  ) throw Error("The export was verified, but no local candidate overview was returned.");
  const response = await fetch(candidate.previewPositionsUrl, { signal });
  if (!response.ok) throw Error("The export was verified, but its candidate overview could not be loaded.");
  const buffer = await response.arrayBuffer();
  if (!buffer.byteLength || buffer.byteLength % 36 !== 0 || buffer.byteLength > 64 * 1024 * 1024)
    throw Error("The exported candidate overview has invalid or oversized geometry.");
  const array = new Float32Array(buffer);
  for (const n of array) {
    if (!Number.isFinite(n)) throw Error("The exported candidate overview contains invalid coordinates.");
  }
  return array;
}
function chosenTriangles(positions, bounds) {
  const selected = new Uint8Array(positions.length / 9);
  let count = 0;
  for (let i = 0; i < positions.length; i += 9) {
    let inside = true;
    for (let v = 0; v < 3 && inside; v++)
      for (let k = 0; k < 3; k++)
        if (
          positions[i + v * 3 + k] < bounds.min[k] ||
          positions[i + v * 3 + k] > bounds.max[k]
        )
          inside = false;
    if (inside) {
      selected[i / 9] = 1;
      count++;
    }
  }
  return { selected, count };
}
function markerLabel(text, color) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(249,247,241,.94)";
  ctx.fillRect(3, 3, 122, 58);
  ctx.fillStyle = color;
  ctx.font = "bold 29px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 64, 32);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false });
  return new THREE.Sprite(material);
}
function setMarkers(engine, source, target, diagonal) {
  const previous = engine.markers;
  previous?.traverse((o) => {
    o.geometry?.dispose();
    if (o.material?.map) o.material.map.dispose();
    o.material?.dispose();
  });
  if (previous) engine.scene.remove(previous);
  const group = new THREE.Group(),
    colors = ["#b6653e", "#2d7d91", "#7d6aa1"];
  for (const [kind, points] of [
    ["S", source],
    ["T", target],
  ])
    points.forEach((point, i) => {
      if (!finitePoint(point)) return;
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(diagonal * 0.0045, 12, 8),
        new THREE.MeshBasicMaterial({
          color: colors[i],
          wireframe: kind === "T",
          depthTest: false,
        }),
      );
      marker.position.fromArray(point);
      marker.renderOrder = 5;
      group.add(marker);
      const label = markerLabel(kind + (i + 1), colors[i]);
      label.position.fromArray(point);
      label.position.z += diagonal * (kind === "S" ? 0.016 : -0.016);
      label.scale.set(diagonal * 0.038, diagonal * 0.019, 1);
      label.renderOrder = 6;
      group.add(label);
    });
  engine.markers = group;
  engine.scene.add(group);
}

export default function RobotRepair() {
  const importId = new URLSearchParams(location.search).get("import") || "";
  const savedCandidateId = new URLSearchParams(location.search).get("candidate") || "";
  const mount = useRef(null),
    engine = useRef(null),
    live = useRef({});
  const [record, setRecord] = useState(null),
    [metadata, setMetadata] = useState(null),
    [positions, setPositions] = useState(null);
  const [regionSuggestions,setRegionSuggestions]=useState([]);
  const [bounds, setBounds] = useState(null),
    [source, setSource] = useState(EMPTY),
    [target, setTarget] = useState(EMPTY);
  const [step, setStep] = useState("region"),
    [activePoint, setActivePoint] = useState({ kind: "source", index: 0 }),
    [regionConfirmed, setRegionConfirmed] = useState(false);
  const [lastPick, setLastPick] = useState(null),
    [radius, setRadius] = useState(1),
    [selectedCount, setSelectedCount] = useState(0);
  const [plan, setPlan] = useState(null),
    [candidate, setCandidate] = useState(null),
    [candidatePositions, setCandidatePositions] = useState(null),
    [candidateMetadata, setCandidateMetadata] = useState(null),
    [version, setVersion] = useState("original"),
    [placementConfirmed, setPlacementConfirmed] = useState(false),
    [up, setUp] = useState("z");
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [goal, setGoal] = useState(
      "Align the intake with its matching mounting points.",
    ),
    [agent, setAgent] = useState(null);
  const diagonal = metadata?.bounds
    ? Math.hypot(
        ...metadata.bounds.max.map((v, i) => v - metadata.bounds.min[i]),
      ) || 1
    : 1;
  const invalidate = () => {
    setPlan(null);
    setCandidate(null);
    setCandidatePositions(null);
    setCandidateMetadata(null);
    setVersion("original");
    setPlacementConfirmed(false);
    setError("");
  };
  function editBounds(side, axis, value) {
    invalidate();
    setRegionConfirmed(false);
    setBounds((old) => ({
      ...old,
      [side]: old[side].map((n, i) => (i === axis ? value : n)),
    }));
  }
  function editPoint(kind, index, axis, value) {
    invalidate();
    (kind === "source" ? setSource : setTarget)((old) =>
      old.map((p, i) =>
        i === index ? p.map((n, k) => (k === axis ? value : n)) : p,
      ),
    );
  }
  function receivePoint(point) {
    const state = live.current;
    setLastPick(point);
    if (state.step !== "mounts") return;
    if (state.activePoint.kind === "source" && !inBox(point, state.bounds)) {
      setError(
        "Choose a source landmark inside the highlighted intake region.",
      );
      return;
    }
    invalidate();
    const key = state.activePoint.kind;
    const index = state.activePoint.index;
    (key === "source" ? setSource : setTarget)((old) =>
      old.map((p, i) => (i === index ? point : p)),
    );
    if (index < 2) setActivePoint({ kind: key, index: index + 1 });
    else if (key === "source") setActivePoint({ kind: "target", index: 0 });
  }
  live.current = { step, activePoint, bounds, version, onPick: receivePoint };
  useEffect(() => {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(importId)) {
      setError("Open a robot import before entering the repair workspace.");
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    (async () => {
      const [a, b] = await Promise.all([
        api(`/api/stl/imports/${importId}`, undefined, controller.signal),
        api(
          `/api/stl/imports/${importId}/repair-data`,
          undefined,
          controller.signal,
        ),
      ]);
      const details = a.import || a;
      const meta = b.metadata;
      if (
        !meta?.bounds ||
        !finitePoint(meta.bounds.min) ||
        !finitePoint(meta.bounds.max)
      )
        throw Error("The repair preview has no valid bounds.");
      if (typeof b.positionsUrl !== "string" || !b.positionsUrl.startsWith("/"))
        throw Error("The repair preview has no local geometry URL.");
      const response = await fetch(b.positionsUrl, {
        signal: controller.signal,
      });
      if (!response.ok)
        throw Error("Could not load the repair overview geometry.");
      const buffer = await response.arrayBuffer();
      if (
        !buffer.byteLength ||
        buffer.byteLength % 36 !== 0 ||
        buffer.byteLength > 64 * 1024 * 1024
      )
        throw Error("Invalid or oversized repair overview geometry.");
      const array = new Float32Array(buffer);
      for (const n of array)
        if (!Number.isFinite(n))
          throw Error("The repair overview contains invalid coordinates.");
      setRecord(details);
      setMetadata(meta);
      setRegionSuggestions(Array.isArray(b.regionSuggestions)?b.regionSuggestions:[]);
      setPositions(array);
      setBounds({ min: [...meta.bounds.min], max: [...meta.bounds.max] });
      setRadius(
        Math.max(...meta.bounds.max.map((v, i) => v - meta.bounds.min[i])) *
          0.08 || 1,
      );
      setLoading(false);
      if (savedCandidateId) {
        if (!/^[a-zA-Z0-9-]{1,100}$/.test(savedCandidateId))
          throw Error("The saved candidate identifier is invalid. Showing the original overview.");
        const saved = await api(
          `/api/stl/imports/${importId}/repair-candidates/${savedCandidateId}`,
          undefined,
          controller.signal,
        );
        const savedPlan = saved.plan;
        if (!saved.candidate?.verified || !savedPlan?.id ||
            !validBounds(savedPlan.bounds) || !Array.isArray(savedPlan.matrix) ||
            savedPlan.matrix.length !== 16 || !savedPlan.matrix.every(Number.isFinite))
          throw Error("This saved candidate has no verified geometry and valid placement plan. Showing the original overview.");
        const candidateArray = await loadCandidatePositions(saved.candidate, controller.signal);
        if (controller.signal.aborted) return;
        setBounds({ min: [...savedPlan.bounds.min], max: [...savedPlan.bounds.max] });
        setSource(savedPlan.sourcePoints?.length === 3 && savedPlan.sourcePoints.every(finitePoint) ? savedPlan.sourcePoints : EMPTY());
        setTarget(savedPlan.targetPoints?.length === 3 && savedPlan.targetPoints.every(finitePoint) ? savedPlan.targetPoints : EMPTY());
        setPlan(savedPlan);
        setCandidate(saved.candidate);
        setCandidatePositions(candidateArray);
        setCandidateMetadata(saved.candidate.previewMetadata || null);
        setPlacementConfirmed(false);
        setRegionConfirmed(false);
        setStep("review");
        setVersion("candidate");
      }
    })().catch((e) => {
      if (e.name !== "AbortError") {
        setError(e.message);
        setLoading(false);
      }
    });
    return () => controller.abort();
  }, [importId, savedCandidateId]);
  useEffect(() => {
    if (!mount.current || !positions || !metadata) return;
    const node = mount.current,
      scene = new THREE.Scene();
    scene.background = new THREE.Color("#e9e8e2");
    const camera = new THREE.PerspectiveCamera(
      38,
      1,
      Math.max(diagonal / 10000, 0.000001),
      diagonal * 100,
    );
    camera.up.set(0, up === "y" ? 1 : 0, up === "z" ? 1 : 0);
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    node.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(positions), 3),
    );
    geometry.setAttribute(
      "color",
      new THREE.BufferAttribute(
        new Float32Array(positions.length).fill(0.62),
        3,
      ),
    );
    geometry.computeVertexNormals();
    geometry.boundsTree=new MeshBVH(geometry,{indirect:true});
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.64,
        metalness: 0.12,
        side: THREE.DoubleSide,
      }),
    );
    scene.add(mesh);
    mesh.raycast=acceleratedRaycast;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x66716b, 2.4));
    const light = new THREE.DirectionalLight(0xffffff, 3.2);
    light.position.set(diagonal, diagonal, diagonal * 2);
    scene.add(light);
    const box = new THREE.Box3Helper(
      new THREE.Box3(new THREE.Vector3(), new THREE.Vector3()),
      0xb46942,
    );
    scene.add(box);
    const state = {
      scene,
      camera,
      renderer,
      controls,
      geometry,
      mesh,
      box,
      markers: null,
    };
    engine.current = state;
    function fit(b = metadata.bounds) {
      const center = new THREE.Vector3()
        .fromArray(b.min)
        .add(new THREE.Vector3().fromArray(b.max))
        .multiplyScalar(0.5);
      const size = Math.hypot(...b.max.map((n, i) => n - b.min[i])) || diagonal;
      controls.target.copy(center);
      camera.position
        .copy(center)
        .add(new THREE.Vector3(size * 0.85, -size * 1.1, size * 0.72));
      camera.near = Math.max(size / 10000, 0.000001);
      camera.far = Math.max(diagonal * 100, size * 100);
      camera.updateProjectionMatrix();
      controls.update();
    }
    state.fit = fit;
    fit();
    const resize = () => {
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      renderer.setSize(rect.width, rect.height);
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    resize();
    let frame,
      down = null;
    const ray = new THREE.Raycaster();
    ray.firstHitOnly=true;
    function pointerDown(e) {
      down = { x: e.clientX, y: e.clientY };
    }
    function pointerUp(e) {
      if (live.current.version === "candidate") return;
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5)
        return;
      down = null;
      const rect = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          (-(e.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      const hit = ray.intersectObject(mesh, false)[0];
      if (!hit || hit.faceIndex == null) return;
      const shownPositions = mesh.geometry.getAttribute("position");
      const vertexIndices = hit.face
        ? [hit.face.a, hit.face.b, hit.face.c]
        : [hit.faceIndex * 3, hit.faceIndex * 3 + 1, hit.faceIndex * 3 + 2];
      let point,
        distance = Infinity;
      for (let v = 0; v < 3; v++) {
        const candidate = new THREE.Vector3().fromBufferAttribute(
          shownPositions,
          vertexIndices[v],
        );
        const d = candidate.distanceToSquared(hit.point);
        if (d < distance) {
          point = candidate.toArray();
          distance = d;
        }
      }
      if (point) live.current.onPick(point);
    }
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointerup", pointerUp);
    function draw() {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(draw);
    }
    draw();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", pointerDown);
      renderer.domElement.removeEventListener("pointerup", pointerUp);
      controls.dispose();
      scene.traverse((o) => {
        o.geometry?.dispose();
        if (o.material?.map) o.material.map.dispose();
        o.material?.dispose();
      });
      renderer.dispose();
      node.replaceChildren();
      engine.current = null;
    };
  }, [positions, metadata]);
  useEffect(() => {
    const e = engine.current;
    if (!e || !bounds) return;
    if (!validBounds(bounds)) {
      e.box.visible = false;
      setSelectedCount(0);
      return;
    }
    const { selected, count } = chosenTriangles(positions, bounds);
    setSelectedCount(count);
    const exported = version === "candidate" && candidatePositions;
    const shown = new Float32Array(exported || positions),
      colors = new Float32Array(shown.length),
      matrix =
        plan?.matrix?.length === 16
          ? new THREE.Matrix4().fromArray(plan.matrix)
          : null,
      point = new THREE.Vector3();
    for (let i = 0; i < shown.length; i += 3) {
      // Exported overview topology may differ; source-region colors do not map to it.
      const chosen = !exported && selected[Math.floor(i / 9)];
      if (!exported && chosen && version === "candidate" && matrix) {
        point.fromArray(positions, i).applyMatrix4(matrix);
        point.toArray(shown, i);
      }
      colors[i] = chosen ? 0.76 : 0.5;
      colors[i + 1] = chosen ? 0.43 : 0.56;
      colors[i + 2] = chosen ? 0.25 : 0.56;
    }
    if (e.geometry.getAttribute("position").array.length !== shown.length) {
      const previous = e.geometry;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(shown, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      geometry.boundsTree = new MeshBVH(geometry, { indirect: true });
      e.mesh.geometry = geometry;
      e.geometry = geometry;
      previous.boundsTree = null;
      previous.dispose();
    } else {
      e.geometry.getAttribute("position").array.set(shown);
      e.geometry.getAttribute("position").needsUpdate = true;
      e.geometry.getAttribute("color").array.set(colors);
      e.geometry.getAttribute("color").needsUpdate = true;
      e.geometry.computeVertexNormals();
      e.geometry.computeBoundingSphere();
      e.geometry.boundsTree?.refit();
    }
    e.box.box.set(
      new THREE.Vector3().fromArray(bounds.min),
      new THREE.Vector3().fromArray(bounds.max),
    );
    e.box.visible = step === "region";
    const shownSource =
      version === "candidate" && matrix
        ? source.map((p) =>
            finitePoint(p)
              ? new THREE.Vector3().fromArray(p).applyMatrix4(matrix).toArray()
              : p,
          )
        : source;
    setMarkers(e, shownSource, target, diagonal);
  }, [positions, candidatePositions, bounds, plan, version, step, source, target]);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    e.camera.up.set(0, up === "y" ? 1 : 0, up === "z" ? 1 : 0);
    e.fit();
  }, [up]);
  useEffect(() => {
    if (step !== "review") setVersion("original");
  }, [step]);
  const pointsReady = source.every(finitePoint) && target.every(finitePoint);
  async function preview() {
    if (!regionConfirmed || !validBounds(bounds) || !pointsReady) return;
    setBusy("preview");
    setError("");
    setCandidate(null);
    setCandidatePositions(null);
    setCandidateMetadata(null);
    try {
      const data = await api(`/api/stl/imports/${importId}/repair-plan`, {
        bounds,
        sourcePoints: source,
        targetPoints: target,
      });
      const value = data.plan || data;
      if (
        !value.id ||
        !Array.isArray(value.matrix) ||
        value.matrix.length !== 16 ||
        !value.matrix.every(Number.isFinite)
      )
        throw Error("The solver did not return a valid alignment plan.");
      setPlan(value);
      setPlacementConfirmed(false);
      setVersion("candidate");
      setStep("review");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }
  async function previewGap() {
    if (!regionConfirmed || !validBounds(bounds)) return;
    setBusy("gap");
    invalidate();
    try {
      const data = await api(`/api/stl/imports/${importId}/repair-gap-plan`, { bounds });
      const value = data.plan || data;
      if (value.kind !== "gap-closure-proposal" || !value.id ||
          !Array.isArray(value.matrix) || value.matrix.length !== 16 ||
          !value.matrix.every(Number.isFinite))
        throw Error("The measured-gap solver did not return a valid placement proposal.");
      setPlan(value);
      setVersion("candidate");
      setStep("review");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }
  async function exportCandidate() {
    if (!plan || !placementConfirmed) return;
    setBusy("export");
    setError("");
    try {
      const data = await api(`/api/stl/imports/${importId}/repair-candidates`, {
        planId: plan.id,
        confirmPlacement: true,
      });
      const value = data.candidate || data;
      setCandidate(value);
      setCandidatePositions(null);
      setCandidateMetadata(null);
      if (value.verified) {
        const array = await loadCandidatePositions(value);
        setCandidatePositions(array);
        setCandidateMetadata(value.previewMetadata || null);
        setVersion("candidate");
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }
  async function askAgent() {
    setBusy("agent");
    setError("");
    try {
      setAgent(
        await api(`/api/stl/imports/${importId}/repair-agent`, {
          goal,
          bounds,
          sourcePoints: source,
          targetPoints: target,
        }),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }
  function useAgentPlan() {
    const value = agent?.plan;
    if (
      !regionConfirmed ||
      !value?.id ||
      !Array.isArray(value.matrix) ||
      value.matrix.length !== 16 ||
      !value.matrix.every(Number.isFinite) ||
      JSON.stringify(value.bounds) !== JSON.stringify(bounds) ||
      (value.kind === "gap-closure-proposal"
        ? !Array.isArray(value.sourcePoints) || value.sourcePoints.length !== 0 ||
          !Array.isArray(value.targetPoints) || value.targetPoints.length !== 0
        : JSON.stringify(value.sourcePoints) !== JSON.stringify(source) ||
          JSON.stringify(value.targetPoints) !== JSON.stringify(target))
    ) {
      setError(
        "Review and enter the proposed region and mounting coordinates before using an agent plan.",
      );
      return;
    }
    setCandidate(null);
    setCandidatePositions(null);
    setCandidateMetadata(null);
    setPlan(value);
    setPlacementConfirmed(false);
    setVersion("candidate");
    setStep("review");
    setError("");
  }
  function useRegion() {
    if (!lastPick || !Number.isFinite(radius) || radius <= 0) return;
    invalidate();
    setRegionConfirmed(false);
    setBounds({
      min: lastPick.map((n) => n - radius),
      max: lastPick.map((n) => n + radius),
    });
  }
  return (
    <main className="robot-repair">
      <header className="rr-header">
        <a href="/">
          <ArrowLeft size={15} /> Earl
        </a>
        <span>
          {record?.filename || record?.name || "Robot repair"}
          <small>Intake alignment</small>
        </span>
        <div>
          {metadata?.units || "Source units"} ·{" "}
          {metadata?.previewOnly ? "Overview" : "Mesh"}
        </div>
      </header>
      <section className="rr-layout">
        <aside className="rr-panel">
          <span className="rr-overline">USER-GUIDED ALIGNMENT</span>
          <h1>
            Put the intake
            <br />
            where it belongs.
          </h1>
          <p className="rr-intro">
            Select the intake, then mark three matching mounting points. Earl
            solves a rigid alignment and exports a separate candidate.
          </p>
          <nav className="rr-steps" aria-label="Repair steps">
            {[
              ["region", "1 Region"],
              ["mounts", "2 Mounts"],
              ["review", "3 Review"],
            ].map(([key, label]) => (
              <button
                key={key}
                aria-current={step === key ? "step" : undefined}
                onClick={() => setStep(key)}
              >
                {label}
              </button>
            ))}
          </nav>
          {loading ? (
            <div className="rr-status">
              <Loader2 className="spin" size={16} /> Loading the mesh overview…
            </div>
          ) : (
            bounds && (
              <>
                {step === "region" && (
                  <div className="rr-section">
                    <h2>Select only the intake.</h2>
                    {regionSuggestions.length>0&&<div className="rr-region-suggestions"><p>Earl found separate groups without cutting any full-resolution triangles. Choose the intake:</p>{regionSuggestions.map((s,i)=><button type="button" key={i} onClick={()=>{invalidate();setRegionConfirmed(false);setSource(EMPTY());setTarget(EMPTY());setBounds({min:[...s.bounds.min],max:[...s.bounds.max]});}}>{s.label} · {s.triangles.toLocaleString()} triangles</button>)}</div>}
                    <p>
                      The orange triangles are inside the box. All three corners
                      of a triangle must be inside to move it.
                    </p>
                    <div className="rr-bounds">
                      <span />
                      <b>Minimum</b>
                      <b>Maximum</b>
                      {["X", "Y", "Z"].map((axis, i) => (
                        <React.Fragment key={axis}>
                          <label>{axis}</label>
                          {["min", "max"].map((side) => (
                            <input
                              key={side}
                              type="number"
                              step="any"
                              aria-label={`${axis} ${side}`}
                              value={bounds[side][i] ?? ""}
                              onChange={(e) =>
                                editBounds(
                                  side,
                                  i,
                                  e.target.value === ""
                                    ? null
                                    : Number(e.target.value),
                                )
                              }
                            />
                          ))}
                        </React.Fragment>
                      ))}
                    </div>
                    <p className="rr-small">
                      {selectedCount.toLocaleString()} overview triangles
                      selected.
                    </p>
                    <div className="rr-region-pick">
                      <p>
                        {lastPick
                          ? `Last pick: ${lastPick.map(compact).join(", ")}`
                          : "Click the intake in the scene to place a selection box."}
                      </p>
                      <label>
                        Box half-size
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={radius}
                          onChange={(e) => setRadius(Number(e.target.value))}
                        />
                      </label>
                      <button
                        disabled={!lastPick || !!busy}
                        onClick={useRegion}
                      >
                        Box around last pick
                      </button>
                    </div>
                    <label className="rr-confirm">
                      <input
                        type="checkbox"
                        checked={regionConfirmed}
                        onChange={(e) => setRegionConfirmed(e.target.checked)}
                      />
                      I checked that this box encloses the intake I intend to
                      move.
                    </label>
                    {regionSuggestions.some((suggestion) =>
                      JSON.stringify(suggestion.bounds) === JSON.stringify(bounds)
                    ) && (
                      <button
                        className="rr-primary"
                        disabled={!regionConfirmed || !!busy}
                        onClick={previewGap}
                      >
                        {busy === "gap" && <Loader2 className="spin" size={15} />}
                        Preview closing measured gap
                        <ArrowRight size={15} />
                      </button>
                    )}
                    <button
                      className="rr-primary"
                      disabled={
                        !regionConfirmed ||
                        !validBounds(bounds) ||
                        !selectedCount
                      }
                      onClick={() => setStep("mounts")}
                    >
                      Mark mounting points
                      <ArrowRight size={15} />
                    </button>
                  </div>
                )}
                {step === "mounts" && (
                  <div className="rr-section">
                    <h2>Match three mounting points.</h2>
                    <p>
                      Pick S1–S3 on the intake, then their matching T1–T3
                      positions on the fixed mount. Preview picks are
                      approximate—confirm coordinates and mounting points.
                    </p>
                    {[
                      ["source", "Intake · source", source],
                      ["target", "Fixed mount · target", target],
                    ].map(([kind, label, points]) => (
                      <div className="rr-landmarks" key={kind}>
                        <h3>{label}</h3>
                        {points.map((point, i) => (
                          <div className="rr-point-row" key={i}>
                            <button
                              aria-pressed={
                                activePoint.kind === kind &&
                                activePoint.index === i
                              }
                              onClick={() => setActivePoint({ kind, index: i })}
                            >
                              {kind === "source" ? "S" : "T"}
                              {i + 1}
                            </button>
                            {point.map((n, k) => (
                              <input
                                key={k}
                                type="number"
                                step="any"
                                aria-label={`${kind} ${i + 1} ${"XYZ"[k]}`}
                                placeholder={"XYZ"[k]}
                                value={n ?? ""}
                                onFocus={() =>
                                  setActivePoint({ kind, index: i })
                                }
                                onChange={(e) =>
                                  editPoint(
                                    kind,
                                    i,
                                    k,
                                    e.target.value === ""
                                      ? null
                                      : Number(e.target.value),
                                  )
                                }
                              />
                            ))}
                          </div>
                        ))}
                      </div>
                    ))}
                    <p className="rr-small">
                      Coordinates use the STL export units: {metadata?.units}.
                      Use three distinct, non-collinear matches.
                    </p>
                    <button
                      className="rr-primary"
                      disabled={!pointsReady || !regionConfirmed || !!busy}
                      onClick={preview}
                    >
                      {busy === "preview" ? (
                        <Loader2 className="spin" size={15} />
                      ) : null}
                      Preview alignment
                      <ArrowRight size={15} />
                    </button>
                  </div>
                )}
                {step === "review" && (
                  <div className="rr-section">
                    <h2>Review the candidate.</h2>
                    {plan ? (
                      <>
                        {plan.kind === "gap-closure-proposal" ? (
                          <p>
                            Proposed {compact(plan.gap)} {metadata?.units} translation along {String(plan.axis || "the measured axis").toUpperCase()}; mounting fit not verified.
                          </p>
                        ) : <div className="rr-metrics">
                          <div>
                            <span>Landmark RMS error</span>
                            <b>
                              {compact(plan.rmsError)} {metadata?.units}
                            </b>
                          </div>
                          <div>
                            <span>Maximum error</span>
                            <b>
                              {compact(plan.maxError)} {metadata?.units}
                            </b>
                          </div>
                        </div>}
                        <p>
                          {candidatePositions
                            ? "The candidate view now shows geometry loaded from the exported candidate. "
                            : "Before export, the candidate view applies the solved transform to the selected overview region. "}
                          Check mounting intent yourself; alignment residuals do
                          not prove mechanical correctness.
                        </p>
                        <label className="rr-confirm">
                          <input
                            type="checkbox"
                            checked={placementConfirmed}
                            onChange={(event) =>
                              setPlacementConfirmed(event.target.checked)
                            }
                          />
                          I checked the proposed mounting position and want to
                          export this placement.
                        </label>
                        <button
                          className="rr-primary"
                          disabled={!!busy || !placementConfirmed}
                          onClick={exportCandidate}
                        >
                          {busy === "export" ? (
                            <Loader2 className="spin" size={15} />
                          ) : null}
                          Export this placement
                          <Download size={15} />
                        </button>
                        {candidate && (
                          <div
                            className={
                              "rr-candidate " +
                              (candidate.verified
                                ? "is-verified"
                                : "is-blocked")
                            }
                          >
                            <h3>
                              {candidate.verified ? (
                                <>
                                  <Check size={15} />
                                  {candidatePositions ? "Exported candidate loaded" : "Candidate ready for review"}
                                </>
                              ) : (
                                <>
                                  <TriangleAlert size={15} />
                                  Candidate not verified
                                </>
                              )}
                            </h3>
                            <p>
                              {candidate.verified
                                ? `The backend checked geometry execution${plan.kind === "gap-closure-proposal" ? " for the proposed translation" : " and landmark alignment"}. Your original file is unchanged. Collisions and mechanical fit are not assessed.`
                                : "Inspect the verification result before using this candidate."}
                            </p>
                            {candidate.verified && candidate.downloadUrl && (
                              <a href={candidate.downloadUrl} download>
                                <Download size={14} />
                                Download full candidate STL
                              </a>
                            )}
                            <details>
                              <summary>Verification details</summary>
                              <pre>
                                {JSON.stringify(
                                  candidate.verification || candidate,
                                  null,
                                  2,
                                )}
                              </pre>
                            </details>
                          </div>
                        )}
                      </>
                    ) : (
                      <p>
                        Mark the mounting points and preview an alignment first.
                      </p>
                    )}
                  </div>
                )}
              </>
            )
          )}
          {error && (
            <div className="rr-error" role="alert">
              <TriangleAlert size={15} />
              <span>{error}</span>
            </div>
          )}
          <details className="rr-agent">
            <summary>
              <Sparkles size={14} /> Ask the repair agent
            </summary>
            <label>
              What should it help with?
              <textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={3}
              />
            </label>
            <button
              disabled={!bounds || !goal.trim() || !!busy}
              onClick={askAgent}
            >
              {busy === "agent" ? (
                <Loader2 className="spin" size={14} />
              ) : (
                <Sparkles size={14} />
              )}
              Ask repair agent
            </button>
            {agent && (
              <div className="rr-agent-answer">
                <small>
                  {agent.provider || "Provider reported by backend"}
                </small>
                <p>
                  {agent.message ||
                    agent.error ||
                    "Inspect the response below."}
                </p>
                {agent.plan && (
                  <>
                    <button
                      disabled={!!busy || !regionConfirmed}
                      onClick={useAgentPlan}
                    >
                      Preview returned plan
                      <ArrowRight size={13} />
                    </button>
                    <p className="rr-small">
                      The plan must match your confirmed region and entered
                      mounting points.
                    </p>
                  </>
                )}
                {agent.actions && (
                  <details>
                    <summary>Proposed actions</summary>
                    <pre>{JSON.stringify(agent.actions, null, 2)}</pre>
                  </details>
                )}
              </div>
            )}
          </details>
        </aside>
        <section className="rr-viewport" aria-label="Robot alignment viewport">
          <div ref={mount} className="rr-canvas" />
          <div className="rr-version">
            <button
              aria-pressed={version === "original"}
              onClick={() => setVersion("original")}
            >
              Original
            </button>
            <button
              disabled={!plan || step !== "review"}
              aria-pressed={version === "candidate"}
              onClick={() => setVersion("candidate")}
            >
              Candidate
            </button>
          </div>
          <div className="rr-view-tools">
            <button
              title="Fit model"
              aria-label="Fit model"
              onClick={() => engine.current?.fit()}
            >
              <Focus size={16} />
            </button>
            <button
              title="Fit selected region"
              aria-label="Fit selected region"
              disabled={!validBounds(bounds)}
              onClick={() => engine.current?.fit(bounds)}
            >
              <RotateCcw size={16} />
            </button>
            <select
              aria-label="View up axis"
              value={up}
              onChange={(e) => setUp(e.target.value)}
            >
              <option value="z">Z up</option>
              <option value="y">Y up</option>
            </select>
          </div>
          <div className="rr-view-caption">
            <span>
              {step === "mounts"
                ? `Picking ${activePoint.kind === "source" ? "S" : "T"}${activePoint.index + 1} · confirm exact mounting coordinates`
                : "Orbit to inspect · click a surface to pick a preview vertex"}
            </span>
            <small>
              {Number(
                version === "candidate" && candidatePositions
                  ? candidatePositions.length / 9
                  : metadata?.previewTriangles || positions?.length / 9 || 0,
              ).toLocaleString()}{" "}
              overview triangles /{" "}
              {Number(
                (version === "candidate" && candidatePositions
                  ? candidateMetadata?.totalTriangles
                  : metadata?.totalTriangles) ||
                  record?.report?.outputTriangles || 0,
              ).toLocaleString()}{" "}
              full triangles · source coordinates
            </small>
            <small>
              Approximate surface overview; small features/gaps may be display artifacts.
            </small>
          </div>
        </section>
      </section>
    </main>
  );
}
