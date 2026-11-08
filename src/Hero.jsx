import React, { Suspense, forwardRef, lazy, useEffect, useState } from "react";
import Intake from "./Intake.jsx";
import "./hero.css";

// three.js is large; the hero text appears first and the scene joins when ready.
const EngineScene = lazy(() => import("./EngineScene.jsx"));

// The first screen. It is self-contained (its own gradient background, no blur
// filters) so the rip transition can clone it into tiles that look identical.
// The 3D scene only exists on screens wide enough to show it.
function useWide() {
  const query = "(min-width: 861px)";
  const [wide, setWide] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const list = matchMedia(query);
    const change = () => setWide(list.matches);
    list.addEventListener("change", change);
    return () => list.removeEventListener("change", change);
  }, []);
  return wide;
}

const Hero = forwardRef(function Hero(
  {
    projects,
    project,
    onPickProject,
    onResults,
    onSettings,
    onHelp,
    ...intake
  },
  ref,
) {
  const wide = useWide();
  // Start loading the 3D agents screen early so it is ready when the rip ends.
  useEffect(() => {
    const t = setTimeout(() => import("./SolarScene.jsx"), 1200);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="hero" ref={ref}>
      <header className="hero-top">
        <span className="hero-tag">Sift · 3D performance engineer</span>
        <nav aria-label="Sift">
          {projects.length > 0 && (
            <label className="hero-picker">
              <span className="visually-hidden">Active project</span>
              <select
                value={project?.id || ""}
                onChange={(e) => onPickProject(e.target.value)}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {onResults && <button onClick={onResults}>Last results</button>}
          <button onClick={onSettings}>Model</button>
          <button onClick={onHelp}>Help</button>
        </nav>
      </header>
      <div className="hero-main">
        <div className="hero-copy">
          <span className="hero-eyebrow">Measure · Patch · Verify</span>
          <h1>Sift</h1>
          <p>
            Open your Three.js app. Investigate the slowdown, test a real
            change, and inspect the evidence.
          </p>
          <Intake project={project} {...intake} onSettings={onSettings} />
        </div>
        {wide && (
          <Suspense fallback={<div className="hero-art" />}>
            <EngineScene />
          </Suspense>
        )}
      </div>
      <footer className="hero-bottom">
        <span>Local folder or project ZIP</span>
        <span>Vite + Three.js · WebGL</span>
      </footer>
    </div>
  );
});
export default Hero;
