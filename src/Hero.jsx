import React, { forwardRef } from "react";
import Intake from "./Intake.jsx";
import "./hero.css";

// The first screen. It is self-contained (its own gradient background, no blur
// filters) so the rip transition can clone it into tiles that look identical.
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
            Drop in a 3D project. Sift finds what is slow, tries a fix on a
            copy, and keeps it only when independent checks say it still looks
            and behaves the same.
          </p>
        </div>
        <Intake project={project} {...intake} onSettings={onSettings} />
      </div>
      <footer className="hero-bottom">
        <span>Runs on your machine</span>
        <span>Vite + Three.js · WebGL</span>
      </footer>
    </div>
  );
});
export default Hero;
