import React, { useEffect, useRef } from "react";
import * as THREE from "three";

// Five two-colour palettes the hero form cycles through on a near-black field.
const palettes = [
  ["#ff4f7a", "#3a1bd0"],
  ["#ff8a1f", "#b3122e"],
  ["#26ddbc", "#0b3fa8"],
  ["#b9ee18", "#145a32"],
  ["#6c88ff", "#2a1b8f"],
].map((pair) => pair.map((hex) => new THREE.Color(hex)));
const HOLD = 3.2,
  MORPH = 1.4;

const formShader = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uShape;
uniform vec3 uA;
uniform vec3 uB;
uniform vec2 uCenter;
uniform float uScale;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
// One soft implicit silhouette; uShape walks smoothly between outlines.
float form(vec2 p, float t, float k) {
  float a = atan(p.y, p.x);
  float edge = 0.6
    + 0.11 * sin(2.0 * a + k * 1.9 + t * 0.35)
    + 0.07 * sin(3.0 * a - k * 2.6 + t * 0.5)
    + 0.04 * sin(5.0 * a + k * 1.3 - t * 0.6);
  return length(p * vec2(1.0, 1.0 + 0.18 * sin(k * 1.7))) - edge;
}
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec2 p = (uv - uCenter) / uScale;
  float d = form(p, uTime, uShape);
  float inside = smoothstep(0.015, -0.03, d);
  float g = clamp(0.5 + 0.6 * dot(p, normalize(vec2(-0.55, 0.85))), 0.0, 1.0);
  vec3 col = mix(uB, uA, g);
  float rim = smoothstep(-0.22, 0.0, d) * inside;
  col = mix(col, vec3(1.0, 0.96, 0.98), rim * rim * 0.55);
  vec3 bg = vec3(0.0196, 0.0235, 0.0314);
  float halo = exp(-max(d, 0.0) * 5.0) * 0.22;
  vec3 c = mix(bg + mix(uB, uA, 0.5) * halo, col, inside);
  c *= 1.0 - 0.35 * length(uv) * length(uv);
  c += (hash(gl_FragCoord.xy + fract(uTime * 7.0) * 91.0) - 0.5) * 0.07;
  gl_FragColor = vec4(c, 1.0);
}`;

const waveVertex = `
uniform float uTime;
uniform vec2 uRipple;
uniform float uPixel;
varying float vHeight;
varying float vAlpha;
void main() {
  vec3 p = position;
  float h = sin(p.x * 0.16 + uTime * 0.7) * 0.32
    + sin(p.z * 0.21 - uTime * 0.55) * 0.3
    + sin((p.x + p.z) * 0.08 + uTime * 0.35) * 0.45;
  float r = length(p.xz - uRipple);
  h += sin(r * 0.85 - uTime * 2.0) * 0.55 * exp(-r * 0.055);
  p.y += h;
  vHeight = h;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float depth = -mv.z;
  gl_PointSize = max(uPixel * 64.0 / depth, 1.0);
  vAlpha = smoothstep(90.0, 18.0, depth) * smoothstep(2.0, 6.0, depth)
    * (1.0 - smoothstep(42.0, 64.0, abs(p.x)));
}`;

const waveFragment = `
varying float vHeight;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float dot = smoothstep(0.5, 0.15, length(c));
  vec3 deep = vec3(0.129, 0.557, 1.0);
  vec3 crest = vec3(0.122, 0.82, 1.0);
  vec3 col = mix(deep, crest, clamp(vHeight * 0.6 + 0.5, 0.0, 1.0));
  gl_FragColor = vec4(col, dot * vAlpha * (0.7 + 0.5 * clamp(vHeight, 0.0, 1.0)));
}`;

// Full-screen hero backdrop: a morphing gradient form above rippling particle water.
export default function Backdrop() {
  const canvas = useRef(null);
  useEffect(() => {
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: canvas.current,
        antialias: false,
        powerPreference: "low-power",
      });
    } catch {
      return; // No WebGL: the CSS gradient fallback behind the canvas stays visible.
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.autoClear = false;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

    const flat = new THREE.Scene(),
      flatCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const formUniforms = {
      uRes: { value: new THREE.Vector2() },
      uTime: { value: 0 },
      uShape: { value: 0 },
      uA: { value: palettes[0][0].clone() },
      uB: { value: palettes[0][1].clone() },
      uCenter: { value: new THREE.Vector2() },
      uScale: { value: 0.3 },
    };
    flat.add(
      new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        new THREE.ShaderMaterial({
          uniforms: formUniforms,
          vertexShader:
            "void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }",
          fragmentShader: formShader,
          depthWrite: false,
        }),
      ),
    );

    const water = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    camera.position.set(0, 3.4, 12);
    camera.lookAt(0, 0.4, -20);
    const cols = 200,
      rows = 110,
      positions = new Float32Array(cols * rows * 3);
    for (let z = 0; z < rows; z++)
      for (let x = 0; x < cols; x++) {
        const i = (z * cols + x) * 3;
        positions[i] = (x / (cols - 1) - 0.5) * 130;
        positions[i + 1] = -2.4;
        positions[i + 2] = 12 - (z / (rows - 1)) * 95;
      }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const waveUniforms = {
      uTime: { value: 0 },
      uRipple: { value: new THREE.Vector2(9, -22) },
      uPixel: { value: renderer.getPixelRatio() },
    };
    water.add(
      new THREE.Points(
        geometry,
        new THREE.ShaderMaterial({
          uniforms: waveUniforms,
          vertexShader: waveVertex,
          fragmentShader: waveFragment,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      ),
    );

    const ripple = new THREE.Vector2(9, -22),
      target = ripple.clone();
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = canvas.current;
      renderer.setSize(w, h, false);
      const aspect = w / h;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      formUniforms.uRes.value.set(
        w * renderer.getPixelRatio(),
        h * renderer.getPixelRatio(),
      );
      // The form sits right of the copy on wide screens, above it on narrow ones.
      if (aspect > 1.05) {
        formUniforms.uCenter.value.set(aspect * 0.24, 0.1);
        formUniforms.uScale.value = 0.3;
        target.set(9, -22);
      } else {
        formUniforms.uCenter.value.set(0.08, 0.3);
        formUniforms.uScale.value = 0.2;
        target.set(2, -26);
      }
      ripple.copy(target);
    };
    const pointer = (e) => {
      const nx = e.clientX / innerWidth - 0.5,
        ny = e.clientY / innerHeight;
      target.set(nx * 46, -40 + ny * 30);
    };
    const mix = (a, b, t) => a.clone().lerp(b, t);
    const draw = (seconds) => {
      const cycle = HOLD + MORPH,
        index = Math.floor(seconds / cycle),
        local = seconds - index * cycle,
        k = Math.max(0, (local - HOLD) / MORPH),
        ease = k * k * (3 - 2 * k),
        from = palettes[index % palettes.length],
        to = palettes[(index + 1) % palettes.length];
      formUniforms.uTime.value = seconds;
      formUniforms.uShape.value = index + ease;
      formUniforms.uA.value.copy(mix(from[0], to[0], ease));
      formUniforms.uB.value.copy(mix(from[1], to[1], ease));
      waveUniforms.uTime.value = seconds;
      ripple.lerp(target, 0.02);
      waveUniforms.uRipple.value.copy(ripple);
      renderer.clear();
      renderer.render(flat, flatCamera);
      renderer.render(water, camera);
    };
    resize();
    let frame = 0;
    const start = performance.now();
    const loop = () => {
      draw((performance.now() - start) / 1000);
      frame = requestAnimationFrame(loop);
    };
    if (still) draw(1.2);
    else loop();
    addEventListener("resize", resize);
    addEventListener("pointermove", pointer);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("resize", resize);
      removeEventListener("pointermove", pointer);
      geometry.dispose();
      renderer.dispose();
    };
  }, []);
  return <canvas className="backdrop" ref={canvas} aria-hidden="true" />;
}
