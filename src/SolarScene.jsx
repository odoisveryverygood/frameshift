import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import createGlobe from "cobe";

// The agents screen as a small solar system. The project is the sun in the middle
// (the rocket from the hero lands in it), and each agent is an Earth-like planet
// (a COBE globe) on its own orbit. Clicking a planet flies in to a close-up where
// thousands of tiny workers build that agent's part of the project. The workers are
// an illustration; which planet is busy, and what it works on, comes from the run.

const ORBIT = { scout: 3.1, gauge: 4.5, smith: 5.9, warden: 7.3 };
const SPEED = { scout: 0.2, gauge: 0.14, smith: 0.1, warden: 0.075 };
const START = { scout: 0.4, gauge: 2.3, smith: 4.1, warden: 5.6 };
const PLANET = 2.5; // sprite size; the globe itself is GLOBE_FILL of it
const GLOBE_FILL = 0.41; // measured: COBE's globe radius / canvas width at scale 1
const ROCKET = [0.255, 0.095, 0.745, 0.618]; // engine region of the hero drawing
const LAND = 1.9;
const WORKERS = 3200;

const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const smooth = (t) => {
  t = Math.min(1, Math.max(0, t));
  return t * t * (3 - 2 * t);
};
const rand = (a, b) => a + Math.random() * (b - a);
const canvasTexture = (size, draw) => {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d"), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

// A COBE globe drawn into its own small canvas and used as a texture.
function makeGlobe(host, size, color, phi) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  host.appendChild(canvas);
  const c = rgb(color);
  const markers = Array.from({ length: 7 }, () => ({
    location: [rand(-50, 60), rand(-180, 180)],
    size: rand(0.03, 0.07),
  }));
  const globe = createGlobe(canvas, {
    devicePixelRatio: 1,
    width: size,
    height: size,
    phi,
    theta: 0.28,
    dark: 0,
    diffuse: 1.25,
    scale: 1,
    mapSamples: size > 400 ? 22000 : 12000,
    mapBrightness: 7,
    baseColor: mix([1, 1, 1], c, 0.1),
    markerColor: c,
    glowColor: mix([1, 1, 1], c, 0.22),
    markers,
    context: { preserveDrawingBuffer: true, alpha: true },
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { globe, texture, canvas, phi };
}

// A tiny worker: a coloured droplet body with a white eye, as a point sprite.
const workerTexture = (color) =>
  canvasTexture(32, (g, s) => {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(s / 2, 3);
    g.bezierCurveTo(s * 0.9, s * 0.45, s * 0.86, s - 3, s / 2, s - 3);
    g.bezierCurveTo(s * 0.14, s - 3, s * 0.1, s * 0.45, s / 2, 3);
    g.fill();
    g.fillStyle = "#fff";
    g.beginPath();
    g.arc(s * 0.56, s * 0.6, s * 0.12, 0, Math.PI * 2);
    g.fill();
  });

export default function SolarScene({
  agents,
  revealed,
  projectName,
  focus,
  onFocus,
}) {
  const box = useRef(null),
    canvas = useRef(null),
    labels = useRef({}),
    siteLabels = useRef([]),
    latest = useRef({});
  latest.current = { agents, revealed, focus, onFocus };
  useEffect(() => {
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: canvas.current,
        antialias: true,
        alpha: true,
      });
    } catch {
      return;
    }
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const host = document.createElement("div");
    host.style.cssText =
      "position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none";
    document.body.appendChild(host);

    // ---------------- The system.
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);
    const home = new THREE.Vector3(0, 9.5, 15);
    camera.position.copy(home);
    const controls = new OrbitControls(camera, canvas.current);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.minDistance = 9;
    controls.maxDistance = 26;
    controls.minPolarAngle = 0.25;
    controls.maxPolarAngle = 1.35;
    controls.autoRotate = !still;
    controls.autoRotateSpeed = 0.18;

    // Galaxy: a faint spiral of dust and a field of far stars.
    const galaxy = new THREE.Group();
    {
      const n = 2600,
        pos = new Float32Array(n * 3),
        col = new Float32Array(n * 3);
      const tints = [
        [0.72, 0.76, 0.85],
        [0.78, 0.74, 0.9],
        [0.86, 0.8, 0.74],
      ];
      for (let i = 0; i < n; i++) {
        const arm = i % 3,
          t = Math.random();
        const r = 8.5 + t * 14 + rand(-0.6, 0.6),
          a = t * 4.2 + (arm * Math.PI * 2) / 3 + rand(-0.25, 0.25);
        pos.set(
          [Math.cos(a) * r, rand(-0.35, 0.35) * (1 + t), Math.sin(a) * r],
          i * 3,
        );
        col.set(tints[i % 3], i * 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      galaxy.add(
        new THREE.Points(
          geo,
          new THREE.PointsMaterial({
            size: 0.07,
            vertexColors: true,
            transparent: true,
            opacity: 0.8,
            depthWrite: false,
          }),
        ),
      );
      const m = 700,
        far = new Float32Array(m * 3);
      for (let i = 0; i < m; i++) {
        const v = new THREE.Vector3(rand(-1, 1), rand(-0.6, 0.8), rand(-1, 1))
          .normalize()
          .multiplyScalar(rand(45, 70));
        far.set([v.x, v.y, v.z], i * 3);
      }
      const fg = new THREE.BufferGeometry();
      fg.setAttribute("position", new THREE.BufferAttribute(far, 3));
      galaxy.add(
        new THREE.Points(
          fg,
          new THREE.PointsMaterial({
            size: 0.18,
            color: "#c3cada",
            transparent: true,
            opacity: 0.7,
            depthWrite: false,
          }),
        ),
      );
    }
    scene.add(galaxy);

    // The sun: your project.
    const sunTex = canvasTexture(256, (g, s) => {
      const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      r.addColorStop(0, "#fffdf5");
      r.addColorStop(0.18, "#fff1c2");
      r.addColorStop(0.32, "#ffcf6a");
      r.addColorStop(0.42, "#ff9a3c");
      r.addColorStop(0.5, "rgba(255,140,60,0.35)");
      r.addColorStop(0.75, "rgba(255,170,90,0.10)");
      r.addColorStop(1, "rgba(255,180,100,0)");
      g.fillStyle = r;
      g.fillRect(0, 0, s, s);
    });
    const sun = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: sunTex,
        depthWrite: false,
        transparent: true,
      }),
    );
    sun.scale.setScalar(still ? 3.4 : 0.001);
    scene.add(sun);
    const flash = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: sunTex,
        depthWrite: false,
        transparent: true,
        opacity: 0,
      }),
    );
    scene.add(flash);

    // The rocket from the hero, coming in to land.
    const rocketMat = new THREE.SpriteMaterial({
      transparent: true,
      depthWrite: false,
    });
    const rocket = new THREE.Sprite(rocketMat);
    rocket.visible = false;
    rocket.center.set(0.5, 0);
    scene.add(rocket);
    const img = new Image();
    img.onload = () => {
      const w = (ROCKET[2] - ROCKET[0]) * img.naturalWidth,
        h = (ROCKET[3] - ROCKET[1]) * img.naturalHeight;
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d").drawImage(
        img,
        ROCKET[0] * img.naturalWidth,
        ROCKET[1] * img.naturalHeight,
        w,
        h,
        0,
        0,
        w,
        h,
      );
      rocketMat.map = new THREE.CanvasTexture(c);
      rocketMat.map.colorSpace = THREE.SRGBColorSpace;
      rocketMat.needsUpdate = true;
      rocket.userData.aspect = w / h;
    };
    img.src = "/engine/raptor.png";
    const flameTex = canvasTexture(128, (g, s) => {
      const r = g.createRadialGradient(
        s / 2,
        s * 0.15,
        2,
        s / 2,
        s * 0.35,
        s * 0.5,
      );
      r.addColorStop(0, "rgba(255,250,220,1)");
      r.addColorStop(0.25, "rgba(255,190,80,0.95)");
      r.addColorStop(0.6, "rgba(255,110,40,0.55)");
      r.addColorStop(1, "rgba(230,60,30,0)");
      g.fillStyle = r;
      g.scale(1, 1);
      g.fillRect(0, 0, s, s);
    });
    const flame = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: flameTex,
        transparent: true,
        depthWrite: false,
      }),
    );
    flame.center.set(0.5, 1);
    flame.visible = false;
    scene.add(flame);

    // Planets.
    const ringTex = canvasTexture(256, (g, s) => {
      g.strokeStyle = "#fff";
      g.lineWidth = 7;
      g.beginPath();
      g.arc(s / 2, s / 2, s / 2 - 8, 0, Math.PI * 2);
      g.stroke();
    });
    const planets = {};
    for (const a of latest.current.agents) {
      const g = makeGlobe(host, 256, a.color, START[a.id]);
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: g.texture,
          transparent: true,
          depthWrite: false,
        }),
      );
      sprite.scale.setScalar(PLANET);
      sprite.userData.id = a.id;
      scene.add(sprite);
      const halo = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: ringTex,
          color: a.color,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      );
      scene.add(halo);
      const pts = Array.from({ length: 129 }, (_, i) => {
        const t = (i / 128) * Math.PI * 2;
        return new THREE.Vector3(
          Math.cos(t) * ORBIT[a.id],
          0,
          Math.sin(t) * ORBIT[a.id],
        );
      });
      const orbit = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({
          color: "#d6dae3",
          transparent: true,
          opacity: 0.9,
        }),
      );
      scene.add(orbit);
      // Packets flowing between the sun and a working planet.
      const pk = new Float32Array(10 * 3);
      const pg = new THREE.BufferGeometry();
      pg.setAttribute("position", new THREE.BufferAttribute(pk, 3));
      const packets = new THREE.Points(
        pg,
        new THREE.PointsMaterial({
          color: a.color,
          size: 0.16,
          transparent: true,
          depthWrite: false,
        }),
      );
      packets.frustumCulled = false;
      scene.add(packets);
      planets[a.id] = {
        ...g,
        sprite,
        halo,
        orbit,
        packets,
        angle: START[a.id],
      };
    }

    // ---------------- The close-up.
    const close = new THREE.Scene();
    close.add(new THREE.HemisphereLight("#ffffff", "#dfe3ec", 1.8));
    const key = new THREE.DirectionalLight("#ffffff", 1.4);
    key.position.set(3, 5, 6);
    close.add(key);
    const closeCam = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    const R = PLANET * GLOBE_FILL; // globe radius in world units
    const closeDist = R / Math.tan(THREE.MathUtils.degToRad(17)) / 0.78;
    closeCam.position.set(0, 0, closeDist);
    closeCam.lookAt(0, 0, 0);
    let big = null; // high-resolution globe of the focused planet
    const bigSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ transparent: true, depthWrite: false }),
    );
    bigSprite.scale.setScalar(PLANET);
    bigSprite.renderOrder = -1;
    close.add(bigSprite);
    // Workers: thousands of points crawling over the front of the globe.
    const wPos = new Float32Array(WORKERS * 3);
    const wGeo = new THREE.BufferGeometry();
    wGeo.setAttribute("position", new THREE.BufferAttribute(wPos, 3));
    const wMat = new THREE.PointsMaterial({
      size: 6,
      sizeAttenuation: false,
      transparent: true,
      depthWrite: false,
      alphaTest: 0.2,
    });
    const workers = new THREE.Points(wGeo, wMat);
    workers.frustumCulled = false;
    close.add(workers);
    const crew = Array.from({ length: WORKERS }, () => ({
      p: new THREE.Vector3(),
      site: 0,
      wait: 0,
      speed: rand(0.25, 0.6),
    }));
    // Work sites, each building a little block structure.
    const SITE_BLOCKS = 45;
    const blocks = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.05 }),
      8 * SITE_BLOCKS,
    );
    blocks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    blocks.frustumCulled = false;
    close.add(blocks);
    let sites = [];
    const frontPoint = (minZ) => {
      const v = new THREE.Vector3();
      do v.set(rand(-1, 1), rand(-1, 1), rand(0, 1));
      while (
        v.lengthSq() > 1 ||
        v.lengthSq() < 0.05 ||
        v.clone().normalize().z < minZ
      );
      return v.normalize();
    };
    function openClose(id) {
      const a = latest.current.agents.find((x) => x.id === id);
      const pl = planets[id];
      if (!big || big.id !== id) {
        big?.globe.destroy();
        big?.canvas.remove();
        big = { ...makeGlobe(host, 768, a.color, pl.phi), id };
        bigSprite.material.map = big.texture;
        bigSprite.material.needsUpdate = true;
      }
      const parts = (a.parts || []).slice(0, 6);
      const n = Math.max(3, parts.length);
      // Spread the sites over the side facing the camera.
      sites = Array.from({ length: n }, (_, i) => {
        const t = (i + 0.5) / n,
          ang = i * 2.4;
        const r = 0.18 + 0.42 * Math.sqrt(t);
        const n0 = new THREE.Vector3(
          Math.cos(ang) * r,
          Math.sin(ang) * r * 0.85,
          0,
        );
        n0.z = Math.sqrt(Math.max(0.05, 1 - n0.lengthSq()));
        n0.normalize();
        const u = new THREE.Vector3(0, 1, 0).cross(n0).normalize(),
          v = n0.clone().cross(u);
        return {
          n: n0,
          u,
          v,
          label: parts[i] || `Part ${i + 1}`,
          built: 0,
          born: [],
          full: 0,
        };
      });
      wMat.map = workerTexture(a.color);
      wMat.needsUpdate = true;
      blocks.material.color.set(a.color).lerp(new THREE.Color("#ffffff"), 0.25);
      crew.forEach((c) => {
        c.p.copy(frontPoint(0.12));
        c.site = Math.floor(Math.random() * sites.length);
        c.wait = rand(0, 1);
      });
    }

    // ---------------- Picking.
    const ray = new THREE.Raycaster(),
      ndc = new THREE.Vector2();
    let down = null;
    const pickPlanet = (e) => {
      const r = canvas.current.getBoundingClientRect();
      ndc.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      );
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(
        Object.values(planets).map((p) => p.sprite),
      )[0];
      return hit?.object.userData.id || null;
    };
    const onDown = (e) => (down = [e.clientX, e.clientY]);
    const onUp = (e) => {
      if (mode !== "system" || !down) return;
      if (Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      const id = pickPlanet(e);
      if (id) latest.current.onFocus(id);
    };
    let hoverAt = 0;
    const onMove = (e) => {
      if (performance.now() - hoverAt < 60 || mode !== "system") return;
      hoverAt = performance.now();
      canvas.current.style.cursor = pickPlanet(e) ? "pointer" : "";
    };
    canvas.current.addEventListener("pointerdown", onDown);
    canvas.current.addEventListener("pointerup", onUp);
    canvas.current.addEventListener("pointermove", onMove);

    let mode = "system"; // system | in | close | out
    const resize = () => {
      if (!box.current) return;
      const w = box.current.clientWidth,
        h = box.current.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = closeCam.aspect = w / h;
      // Fit the outermost orbit (and its planet) on screen.
      const half = Math.tan(THREE.MathUtils.degToRad(17));
      const need = ORBIT.warden + PLANET * 0.6;
      const d = Math.max(need / (half * (w / h)), (need * 0.62) / half) * 1.02;
      home.set(0, 0.55, 0.835).normalize().multiplyScalar(d);
      if (mode === "system") camera.position.copy(home);
      camera.updateProjectionMatrix();
      closeCam.updateProjectionMatrix();
    };
    const watcher = new ResizeObserver(resize);
    watcher.observe(box.current);
    resize();

    // ---------------- Loop.
    let raf = 0,
      last = performance.now(),
      clock = 0,
      orbitClock = 0,
      landT = still ? LAND : -1,
      modeT = 0,
      focusId = null;
    const saved = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
    const flyFrom = new THREE.Vector3(),
      flyTo = new THREE.Vector3(),
      tmp = new THREE.Vector3(),
      tmp2 = new THREE.Vector3(),
      q = new THREE.Quaternion(),
      m4 = new THREE.Matrix4(),
      up = new THREE.Vector3(0, 1, 0);
    const toScreen = (v, cam) => {
      tmp2.copy(v).project(cam);
      const r = canvas.current.getBoundingClientRect();
      return [
        ((tmp2.x + 1) / 2) * r.width,
        ((1 - tmp2.y) / 2) * r.height,
        tmp2.z,
      ];
    };

    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (!canvas.current) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      clock += dt;
      const { agents: list, revealed, focus } = latest.current;

      // Focus changes from outside (planet click, panel, Back).
      if (
        focus &&
        focus !== focusId &&
        (mode === "system" || mode === "close")
      ) {
        focusId = focus;
        if (mode === "system") {
          saved.pos.copy(camera.position);
          saved.target.copy(controls.target);
        }
        flyFrom.copy(camera.position);
        mode = "in";
        modeT = 0;
        controls.enabled = false;
      } else if (!focus && (mode === "close" || mode === "in")) {
        mode = "out";
        modeT = 0;
        if (focusId) {
          flyFrom
            .copy(planets[focusId].sprite.position)
            .addScaledVector(
              tmp
                .copy(saved.pos)
                .sub(planets[focusId].sprite.position)
                .normalize(),
              closeDist,
            );
          camera.position.copy(flyFrom);
          camera.lookAt(planets[focusId].sprite.position);
        }
      }
      modeT += dt;

      // ---- Landing: the rocket comes down into the sun, then the sun ignites.
      if (landT < 0 && revealed) landT = 0;
      if (landT >= 0 && landT < LAND + 2) landT += dt;
      const lt = Math.min(1, Math.max(0, landT) / LAND);
      const landed = landT >= LAND;
      if (rocket.userData.aspect && landT >= 0 && !landed) {
        rocket.visible = flame.visible = true;
        const h = 2.4 * (1 - 0.65 * smooth(lt));
        rocket.scale.set(h * rocket.userData.aspect, h, 1);
        const y = 0.2 + Math.pow(1 - lt, 2.2) * 10;
        rocket.position.set(0, y, 0);
        flame.position.set(0, y + h * 0.02, 0);
        flame.scale.set(h * 0.55, h * (0.7 + Math.sin(clock * 40) * 0.06), 1);
        rocket.material.opacity = 1 - smooth((lt - 0.85) / 0.15);
        flame.material.opacity = rocket.material.opacity;
      } else rocket.visible = flame.visible = false;
      const ignite = landed ? smooth((landT - LAND) / 0.6) : 0;
      if (!still)
        sun.scale.setScalar(
          Math.max(
            0.001,
            (0.6 + 2.8 * ignite) * (1 + Math.sin(clock * 2) * 0.02),
          ),
        );
      flash.scale.setScalar(3 + (landT - LAND) * 9);
      flash.material.opacity = landed
        ? Math.max(0, 0.6 - (landT - LAND) * 0.8)
        : 0;
      const appear = still
        ? 1
        : landed
          ? smooth((landT - LAND - 0.2) / 1.0)
          : 0;

      // ---- System.
      if (mode !== "close") {
        if (mode === "system" && !still) orbitClock += dt;
        galaxy.rotation.y += dt * 0.01;
        const active = list.find((a) => a.state === "working");
        for (const a of list) {
          const p = planets[a.id];
          if (!p) continue;
          const ang = START[a.id] + orbitClock * SPEED[a.id];
          p.sprite.position.set(
            Math.cos(ang) * ORBIT[a.id],
            0,
            Math.sin(ang) * ORBIT[a.id],
          );
          const working = a.state === "working";
          const pulse = working ? 1 + Math.sin(clock * 3) * 0.04 : 1;
          p.sprite.scale.setScalar(
            PLANET * appear * pulse * (working ? 1.12 : 1),
          );
          p.sprite.material.opacity = a.state === "waiting" ? 0.7 : 1;
          p.phi += dt * (working ? 0.6 : 0.25);
          p.globe.update({ phi: p.phi });
          p.texture.needsUpdate = true;
          p.halo.position.copy(p.sprite.position);
          p.halo.scale.setScalar(
            PLANET *
              GLOBE_FILL *
              2.5 *
              appear *
              (working ? 1 + (clock % 1.2) * 0.25 : 1),
          );
          p.halo.material.color.set(a.state === "done" ? "#0f8a5f" : a.color);
          p.halo.material.opacity =
            (working
              ? 0.8 * (1 - (clock % 1.2) / 1.2)
              : a.state === "done"
                ? 0.55
                : 0) * appear;
          p.orbit.material.color.set(
            working ? a.color : a.state === "done" ? "#9fd3be" : "#d6dae3",
          );
          p.orbit.material.opacity = appear * (working ? 1 : 0.9);
          // Packets run from the sun to the planet that is working.
          p.packets.visible = working && appear > 0.5;
          if (p.packets.visible) {
            const arr = p.packets.geometry.attributes.position.array;
            for (let k = 0; k < 10; k++) {
              const t = (clock * 0.5 + k / 10) % 1;
              tmp.copy(p.sprite.position).multiplyScalar(t);
              tmp.y += Math.sin(t * Math.PI) * 0.5;
              arr.set([tmp.x, tmp.y, tmp.z], k * 3);
            }
            p.packets.geometry.attributes.position.needsUpdate = true;
          }
        }
        // Camera: free orbit, or flying in / out of a planet.
        if (mode === "in" && focusId) {
          const target = planets[focusId].sprite.position;
          flyTo
            .copy(target)
            .addScaledVector(
              tmp.copy(flyFrom).sub(target).normalize(),
              closeDist,
            );
          const k = smooth(modeT / 1.1);
          camera.position.lerpVectors(flyFrom, flyTo, k);
          controls.target.lerpVectors(saved.target, target, k);
          camera.lookAt(controls.target);
          if (modeT >= 1.1) {
            mode = "close";
            modeT = 0;
            openClose(focusId);
          }
        } else if (mode === "out") {
          const k = smooth(modeT / 1.0);
          camera.position.lerpVectors(flyFrom, saved.pos, k);
          if (focusId)
            controls.target.lerpVectors(
              planets[focusId].sprite.position,
              saved.target,
              k,
            );
          camera.lookAt(controls.target);
          if (modeT >= 1.0) {
            mode = "system";
            focusId = null;
            controls.enabled = true;
          }
        } else controls.update();
        renderer.render(scene, camera);
      }

      // ---- Close-up: workers carrying pieces to the sites and building them.
      if (mode === "close" && big) {
        big.phi += dt * 0.02;
        big.globe.update({ phi: big.phi });
        big.texture.needsUpdate = true;
        const fadeIn = smooth(modeT / 0.8);
        wMat.opacity = fadeIn;
        const rr = R * 1.01;
        for (let i = 0; i < WORKERS; i++) {
          const c = crew[i],
            s = sites[c.site];
          if (c.wait > 0) {
            c.wait -= dt;
            // Working at a site: a small jitter.
            tmp
              .copy(c.p)
              .addScaledVector(s.u, Math.sin(clock * 20 + i) * 0.004);
          } else {
            tmp.copy(s.n).sub(c.p);
            const d = tmp.length();
            if (d < 0.06) {
              c.wait = rand(0.6, 2.2);
              s.built += 0.035;
              if (Math.random() < 0.5)
                c.site = Math.floor(Math.random() * sites.length);
            } else {
              c.p
                .addScaledVector(tmp.normalize(), Math.min(d, c.speed * dt))
                .normalize();
              if (c.p.z < 0.08) c.p.z = 0.08;
              c.p.normalize();
            }
            tmp.copy(c.p);
          }
          // Each worker stands at a slightly different spot around its site.
          const spread = c.wait > 0 ? 0.035 + (i % 7) * 0.006 : 0;
          tmp
            .addScaledVector(s.u, spread * Math.cos(i))
            .addScaledVector(s.v, spread * Math.sin(i * 1.7))
            .normalize()
            .multiplyScalar(rr);
          wPos.set([tmp.x, tmp.y, tmp.z], i * 3);
        }
        wGeo.attributes.position.needsUpdate = true;
        // Blocks: each site's structure grows as the workers deliver.
        const bs = R * 0.085;
        let idx = 0;
        sites.forEach((s, si) => {
          const count = Math.min(SITE_BLOCKS, Math.floor(s.built));
          while (s.born.length < count) s.born.push(clock);
          if (count >= SITE_BLOCKS) {
            s.full += dt;
            if (s.full > 2.5) {
              s.built = 0;
              s.born = [];
              s.full = 0;
            }
          }
          q.setFromUnitVectors(up, s.n);
          for (let k = 0; k < SITE_BLOCKS; k++) {
            const pop =
              k < s.born.length ? smooth((clock - s.born[k]) / 0.35) : 0;
            const layer = Math.floor(k / 9),
              gx = (k % 3) - 1,
              gz = Math.floor((k % 9) / 3) - 1;
            const taper = 1 - layer * 0.12;
            tmp
              .copy(s.n)
              .multiplyScalar(R + bs * (layer + 0.5))
              .addScaledVector(s.u, gx * bs * 1.05 * taper)
              .addScaledVector(s.v, gz * bs * 1.05 * taper);
            m4.compose(tmp, q, tmp2.setScalar(bs * 0.95 * pop * taper + 1e-4));
            blocks.setMatrixAt(si * SITE_BLOCKS + k, m4);
            idx++;
          }
        });
        for (; idx < blocks.count; idx++)
          blocks.setMatrixAt(idx, m4.makeScale(0, 0, 0));
        blocks.instanceMatrix.needsUpdate = true;
        renderer.render(close, closeCam);
      }

      // ---- Labels.
      const showSystem = mode !== "close";
      for (const a of list) {
        const el = labels.current[a.id],
          p = planets[a.id];
        if (!el || !p) continue;
        const [x, y] = toScreen(tmp.copy(p.sprite.position), camera);
        const [, y2] = toScreen(
          tmp
            .copy(p.sprite.position)
            .addScaledVector(camera.up, -PLANET * GLOBE_FILL),
          camera,
        );
        el.style.transform = `translate(${x}px, ${y2 + 8}px) translate(-50%, 0)`;
        el.style.opacity =
          showSystem && mode === "system" && appear > 0.6 ? 1 : 0;
        el.style.pointerEvents =
          showSystem && mode === "system" ? "auto" : "none";
        void y;
      }
      siteLabels.current.forEach((el, i) => {
        if (!el) return;
        const s = sites[i];
        if (mode !== "close" || !s) {
          el.style.opacity = 0;
          return;
        }
        const [x, y] = toScreen(
          tmp.copy(s.n).multiplyScalar(R * 1.42),
          closeCam,
        );
        el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
        el.style.opacity = smooth((modeT - 0.4) / 0.6);
        el.textContent = `${s.label} · ${Math.round((Math.min(SITE_BLOCKS, s.built) / SITE_BLOCKS) * 100)}%`;
      });
    }
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      watcher.disconnect();
      controls.dispose();
      const c = canvas.current;
      if (c) {
        c.removeEventListener("pointerdown", onDown);
        c.removeEventListener("pointerup", onUp);
        c.removeEventListener("pointermove", onMove);
      }
      Object.values(planets).forEach((p) => p.globe.destroy());
      big?.globe.destroy();
      host.remove();
      [scene, close].forEach((s) =>
        s.traverse((o) => {
          o.geometry?.dispose?.();
          o.material?.map?.dispose?.();
          o.material?.dispose?.();
        }),
      );
      renderer.dispose();
    };
  }, []);
  const statusText = { working: "Working", done: "Done", waiting: "Waiting" };
  const focused = agents.find((a) => a.id === focus);
  return (
    <div className={"solar-scene " + (focus ? "is-close" : "")} ref={box}>
      <canvas className="solar-canvas" ref={canvas} aria-hidden="true" />
      {agents.map((a) => (
        <button
          key={a.id}
          type="button"
          ref={(el) => (labels.current[a.id] = el)}
          className={"planet-label " + a.state}
          style={{ "--c": a.color }}
          onClick={() => onFocus(a.id)}
          aria-label={`Fly in to ${a.name}: ${a.role}. ${statusText[a.state]}.`}
        >
          <i aria-hidden="true" />
          {a.name}
          <em>{statusText[a.state]}</em>
        </button>
      ))}
      {Array.from({ length: 6 }, (_, i) => (
        <span
          key={i}
          ref={(el) => (siteLabels.current[i] = el)}
          className="site-label"
          style={{ "--c": focused?.color }}
          aria-hidden="true"
        />
      ))}
      {focus && (
        <button
          type="button"
          className="solar-back"
          onClick={() => onFocus(null)}
        >
          ← Back to the system
        </button>
      )}
      <p className="solar-help" aria-hidden="true">
        {focus
          ? "Workers are an illustration of this stage"
          : "Drag to turn · scroll to zoom · click a planet"}
      </p>
    </div>
  );
}
