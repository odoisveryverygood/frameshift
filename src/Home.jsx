import React, { useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Boxes,
  Check,
  CodeXml,
  FolderUp,
  Gamepad2,
  Loader2,
  ScanLine,
  TriangleAlert,
} from "lucide-react";
import Backdrop from "./Backdrop.jsx";

const kinds = [
  {
    id: "software",
    icon: CodeXml,
    title: "Web & software",
    detail: "Vite + Three.js project folder",
    support: "Supported",
  },
  {
    id: "game",
    icon: Gamepad2,
    title: "Game builds",
    detail: "Three.js / WebGL games built with Vite",
    support: "Supported",
  },
  {
    id: "cad",
    icon: Boxes,
    title: "CAD & models",
    detail: "STEP, STL, GLB",
    support: "Planned",
  },
];
const cadPattern = /\.(step|stp|stl|glb|gltf|obj|fbx|iges|igs|3mf|sldprt)$/i;
const examples = [
  ["warehouse", "Warehouse robotics", "1,600 moving objects"],
  ["fleet", "Circular fleet", "800 moving objects"],
  ["assembly", "Assembly floor", "1,200 moving objects"],
];

export default function Home({
  projects,
  busy,
  onInspect,
  onConnect,
  onExample,
  onOpenProject,
  onSettings,
  onHelp,
}) {
  const [path, setPath] = useState(""),
    [trusted, setTrusted] = useState(false),
    [discovery, setDiscovery] = useState(null),
    [scanning, setScanning] = useState(false),
    [error, setError] = useState(""),
    [hint, setHint] = useState(""),
    [dragging, setDragging] = useState(false),
    [goal, setGoal] = useState("");
  const input = useRef(null),
    depth = useRef(0);
  async function scan() {
    setScanning(true);
    setError("");
    try {
      setDiscovery(await onInspect(path));
    } catch (e) {
      setError(e.message);
      setDiscovery(null);
    } finally {
      setScanning(false);
    }
  }
  // Browsers never reveal where a dropped folder lives on disk, so a drop
  // identifies the item and asks for its path instead of pretending to upload.
  function drop(e) {
    e.preventDefault();
    depth.current = 0;
    setDragging(false);
    const text = e.dataTransfer.getData("text/plain").trim();
    if (text.startsWith("/") || text.startsWith("file://")) {
      setPath(decodeURI(text.replace(/^file:\/\//, "")));
      setDiscovery(null);
      setHint("");
      return;
    }
    const item = [...e.dataTransfer.items].find((i) => i.kind === "file");
    const entry = item?.webkitGetAsEntry?.();
    const name = entry?.name || e.dataTransfer.files[0]?.name;
    if (!name) return;
    if (cadPattern.test(name))
      setHint(
        `${name} is a CAD or model file. CAD import is planned; today Sift works on Vite + Three.js project folders.`,
      );
    else if (entry?.isDirectory)
      setHint(
        `Got “${name}”. Your browser keeps folder locations private, so paste its full path below (in Finder: right-click → Copy as Pathname).`,
      );
    else
      setHint(
        `${name} is a single file. Sift connects a whole project folder — paste the folder's path below.`,
      );
    input.current?.focus();
  }
  return (
    <div className="home">
      <Backdrop />
      <header className="home-top">
        <span className="wordmark">
          sift<span>.</span>
        </span>
        <nav aria-label="Sift">
          {projects.length > 0 && (
            <button onClick={() => onOpenProject(projects[0].id)}>
              Workspace
            </button>
          )}
          <button onClick={onSettings}>Model</button>
          <button onClick={onHelp}>Help</button>
        </nav>
      </header>
      <main className="hero">
        <div className="hero-copy">
          <span className="pill">
            <i aria-hidden="true" /> Runs on your machine
          </span>
          <h1>
            Drop in your project.
            <span className="gradient-text">Sift finds what’s slow.</span>
          </h1>
          <p>
            Sift measures your 3D app, tries a fix on a copy, and keeps it only
            when independent checks show it looks and behaves the same.
          </p>
        </div>
        <form
          className={"dropzone " + (dragging ? "is-dragging" : "")}
          aria-label="Add your project"
          onSubmit={(e) => {
            e.preventDefault();
            onConnect({ path, trusted, mission: goal });
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            depth.current++;
            setDragging(true);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => {
            depth.current = Math.max(0, depth.current - 1);
            if (!depth.current) setDragging(false);
          }}
          onDrop={drop}
        >
          <div className="dropzone-head">
            <span className="dropzone-icon">
              <FolderUp size={20} aria-hidden="true" />
            </span>
            <div>
              <h2>Add your project</h2>
              <p>Drop a folder here or paste its path. Nothing is uploaded.</p>
            </div>
          </div>
          <ul className="kinds" aria-label="What Sift can work on">
            {kinds.map(({ id, icon: Icon, title, detail, support }) => (
              <li key={id} className={support === "Planned" ? "planned" : ""}>
                <Icon size={16} aria-hidden="true" />
                <span>
                  <b>{title}</b>
                  <small>{detail}</small>
                </span>
                <em>{support}</em>
              </li>
            ))}
          </ul>
          <label className="goal" htmlFor="goal">
            <span>
              What feels slow?{" "}
              <em>Optional — Sift starts on it right after the first build.</em>
            </span>
            <textarea
              id="goal"
              rows={2}
              maxLength={4000}
              value={goal}
              placeholder="It stutters when more robots are on screen. Keep it looking and behaving the same."
              onChange={(e) => setGoal(e.target.value)}
            />
          </label>
          <label className="visually-hidden" htmlFor="project-path">
            Project folder path
          </label>
          <div className="path-row">
            <input
              id="project-path"
              ref={input}
              placeholder="/Users/you/projects/my-scene"
              value={path}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => {
                setPath(e.target.value);
                setDiscovery(null);
                setHint("");
              }}
              required
            />
            <button type="button" disabled={!path || scanning} onClick={scan}>
              {scanning ? (
                <Loader2 size={14} className="spin" />
              ) : (
                <ScanLine size={14} />
              )}
              Inspect
            </button>
          </div>
          {hint && (
            <p className="drop-hint" role="status">
              {hint}
            </p>
          )}
          {error && (
            <p className="drop-error" role="alert">
              <TriangleAlert size={14} aria-hidden="true" /> {error}
            </p>
          )}
          {discovery && (
            <div
              className={
                "inspected " + (discovery.supported === false ? "bad" : "")
              }
            >
              <b>
                {discovery.supported === false ? (
                  <TriangleAlert size={14} />
                ) : (
                  <Check size={14} />
                )}
                {discovery.name || "Project inspected"}
              </b>
              <span>
                {discovery.framework || "Unknown framework"}
                {discovery.threeVersion
                  ? " · Three.js " + discovery.threeVersion
                  : ""}
                {discovery.entryPoints?.length
                  ? " · " + discovery.entryPoints.join(", ")
                  : ""}
              </span>
              {discovery.issues?.slice(0, 3).map((issue, i) => (
                <small key={i}>
                  {typeof issue === "string"
                    ? issue
                    : issue.message || issue.detail}
                </small>
              ))}
            </div>
          )}
          <label className="trust">
            <input
              type="checkbox"
              checked={trusted}
              onChange={(e) => setTrusted(e.target.checked)}
            />
            <span>
              I trust this project’s code and build setup, and I’m allowed to
              run it.
            </span>
          </label>
          <button
            type="submit"
            className="cta"
            disabled={
              !path ||
              !trusted ||
              busy ||
              scanning ||
              discovery?.supported === false
            }
          >
            {busy ? <Loader2 size={15} className="spin" /> : null}
            Connect & build preview <ArrowRight size={15} />
          </button>
        </form>
      </main>
      <section className="starters" aria-labelledby="starters-title">
        <h2 id="starters-title">
          {projects.length ? "Your projects" : "Or start with a real scene"}
        </h2>
        <div className="starter-cards">
          {(projects.length
            ? projects
                .slice(0, 3)
                .map((p) => [
                  p.id,
                  p.name,
                  p.discovery?.framework || "Three.js project",
                  () => onOpenProject(p.id),
                ])
            : examples.map(([id, title, detail]) => [
                id,
                title,
                detail,
                () => onExample(id),
              ])
          ).map(([id, title, detail, open]) => (
            <button key={id} disabled={busy} onClick={open}>
              <span>
                <b>{title}</b>
                <small>{detail}</small>
              </span>
              <ArrowUpRight size={15} aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
