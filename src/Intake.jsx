import React, { useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  FolderUp,
  Loader2,
  TriangleAlert,
} from "lucide-react";

const cadPattern = /\.(step|stp|stl|glb|gltf|obj|fbx|iges|igs|3mf|sldprt)$/i;
const examples = [
  ["warehouse", "Warehouse robotics"],
  ["fleet", "Circular fleet"],
  ["assembly", "Assembly floor"],
];

// The hero's form: a project (dropped or pasted path), what feels slow, and one
// Optimize button. Nothing is uploaded; the local runner reads the folder in place.
export default function Intake({
  project,
  sourceCount,
  busy,
  running,
  mission,
  onMission,
  providerConfigured,
  onInspect,
  onOptimize,
  onExample,
  onSettings,
}) {
  const [path, setPath] = useState(""),
    [trusted, setTrusted] = useState(false),
    [discovery, setDiscovery] = useState(null),
    [scanning, setScanning] = useState(false),
    [error, setError] = useState(""),
    [hint, setHint] = useState(""),
    [dragging, setDragging] = useState(false),
    [changing, setChanging] = useState(false);
  const input = useRef(null),
    depth = useRef(0);
  const existing = Boolean(project) && !changing;
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
    setChanging(true);
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
        `${name} is a single file. Sift connects a whole project folder. Paste the folder's path below.`,
      );
    setTimeout(() => input.current?.focus(), 0);
  }
  function submit(e) {
    e.preventDefault();
    const box = (
      e.nativeEvent.submitter || e.currentTarget
    ).getBoundingClientRect();
    onOptimize(existing ? null : { path, trusted }, {
      x: box.left + box.width / 2,
      y: box.top + box.height / 2,
    });
  }
  return (
    <form
      className={"intake " + (dragging ? "is-dragging" : "")}
      aria-label="Add your project and optimize"
      onSubmit={submit}
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
      {existing ? (
        <div className="intake-project">
          <FolderUp size={22} aria-hidden="true" />
          <div>
            <b>{project.name}</b>
            <span>
              {project.discovery?.framework || "Three.js"}
              {project.discovery?.threeVersion
                ? " · " + project.discovery.threeVersion
                : ""}
              {sourceCount ? ` · ${sourceCount} source files` : ""}
            </span>
          </div>
          <button
            type="button"
            className="link-button"
            onClick={() => setChanging(true)}
          >
            Change
          </button>
        </div>
      ) : (
        <>
          <div className="intake-drop">
            <FolderUp size={24} aria-hidden="true" />
            <div>
              <b>Drop your project folder here</b>
              <span>or paste its path. Nothing is uploaded.</span>
            </div>
          </div>
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
            />
            <button
              type="button"
              className="secondary-button"
              disabled={!path || scanning}
              onClick={scan}
            >
              {scanning ? <Loader2 size={14} className="spin" /> : null}
              Inspect
            </button>
          </div>
          <p className="intake-kinds">
            Web & software · Game builds (Vite + Three.js) · CAD & models
            planned
          </p>
          {hint && (
            <p className="intake-note" role="status">
              {hint}
            </p>
          )}
          {error && (
            <p className="intake-note bad" role="alert">
              <TriangleAlert size={14} aria-hidden="true" /> {error}
            </p>
          )}
          {discovery && (
            <div
              className={
                "intake-note " +
                (discovery.supported === false ? "bad" : "good")
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
        </>
      )}
      <label className="intake-goal" htmlFor="goal">
        <span>What feels slow?</span>
        <textarea
          id="goal"
          rows={3}
          maxLength={4000}
          value={mission}
          placeholder="It stutters when more robots are on screen. Keep it looking and behaving the same."
          onChange={(e) => onMission(e.target.value)}
          disabled={busy || running}
        />
      </label>
      {!existing && (
        <label className="intake-trust">
          <input
            type="checkbox"
            checked={trusted}
            onChange={(e) => setTrusted(e.target.checked)}
          />
          <span>
            I trust this project’s code and build setup, and I’m allowed to run
            it.
          </span>
        </label>
      )}
      {!providerConfigured && (
        <p className="intake-model">
          Optimizing needs a model connection.{" "}
          <button type="button" onClick={onSettings}>
            Set up model
          </button>
        </p>
      )}
      <button
        type="submit"
        className="optimize"
        disabled={
          busy ||
          running ||
          (!existing &&
            (!path || !trusted || scanning || discovery?.supported === false))
        }
      >
        {busy ? <Loader2 size={17} className="spin" /> : null}
        Optimize <ArrowRight size={17} aria-hidden="true" />
      </button>
      {!existing && (
        <p className="intake-examples">
          or try
          {examples.map(([id, title]) => (
            <button
              type="button"
              key={id}
              disabled={busy || running}
              onClick={(e) => {
                const b = e.currentTarget.getBoundingClientRect();
                onExample(id, {
                  x: b.left + b.width / 2,
                  y: b.top + b.height / 2,
                });
              }}
            >
              {title}
            </button>
          ))}
        </p>
      )}
    </form>
  );
}
