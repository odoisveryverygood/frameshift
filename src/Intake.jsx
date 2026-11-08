import React, { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  FolderUp,
  Loader2,
  TriangleAlert,
  Upload,
} from "lucide-react";

const MAX_ZIP_BYTES = 20 * 1024 * 1024;
const cadPattern = /\.(step|stp|stl|glb|gltf|obj|fbx|iges|igs|3mf|sldprt)$/i;
const examples = [
  ["relay", "2,000 robot simulator"],
  ["warehouse", "Warehouse robotics"],
  ["fleet", "Circular fleet"],
  ["assembly", "Assembly floor"],
];

// Inspect only reads project files. Trust and Optimize remain a separate action.
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
    [discoveryPath, setDiscoveryPath] = useState(""),
    [scanning, setScanning] = useState(false),
    [error, setError] = useState(""),
    [hint, setHint] = useState(""),
    [dragging, setDragging] = useState(false),
    [changing, setChanging] = useState(false),
    [upload, setUpload] = useState(null);
  const input = useRef(null),
    picker = useRef(null),
    depth = useRef(0),
    request = useRef(null),
    generation = useRef(0);
  const existing = Boolean(project) && !changing;
  const locked = Boolean(busy || running || scanning);
  const inspected = Boolean(discovery && discoveryPath === path.trim());
  const compatible = inspected && discovery.supported === true;
  useEffect(
    () => () => {
      generation.current++;
      request.current?.abort();
    },
    [],
  );
  function resetSource(nextPath = "") {
    generation.current++;
    request.current?.abort();
    request.current = null;
    setPath(nextPath);
    setDiscovery(null);
    setDiscoveryPath("");
    setTrusted(false);
    setUpload(null);
    setError("");
    setHint("");
    setScanning(false);
  }
  async function scan() {
    const selectedPath = path.trim();
    if (!selectedPath || locked) return;
    const version = ++generation.current;
    setScanning(true);
    setError("");
    setTrusted(false);
    setDiscovery(null);
    setDiscoveryPath("");
    try {
      const result = await onInspect(selectedPath);
      if (version !== generation.current) return;
      setPath(selectedPath);
      setDiscovery(result);
      setDiscoveryPath(selectedPath);
    } catch (e) {
      if (version === generation.current) setError(e.message || String(e));
    } finally {
      if (version === generation.current) setScanning(false);
    }
  }
  async function uploadZip(file) {
    if (!file || busy || running || scanning) return;
    setChanging(true);
    resetSource();
    if (!/\.zip$/i.test(file.name)) {
      setError(
        "Choose a ZIP containing your web project, including package.json and source files.",
      );
      return;
    }
    if (!file.size || file.size > MAX_ZIP_BYTES) {
      setError(
        "Choose a ZIP up to 20 MiB. Leave out node_modules, .git, and build output.",
      );
      return;
    }
    const abort = new AbortController(),
      version = ++generation.current;
    request.current = abort;
    setScanning(true);
    setHint(
      "Uploading and inspecting files. Project code is not run during inspection.",
    );
    try {
      const response = await fetch("/api/uploads/project", {
        method: "POST",
        headers: {
          "Content-Type": "application/zip",
          "X-Upload-Name": encodeURIComponent(file.name),
        },
        body: file,
        signal: abort.signal,
        credentials: "same-origin",
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw Error(
          result.error ||
            (response.status === 401
              ? "Sign in to this hosted instance before uploading a project."
              : `Project upload failed (${response.status}).`),
        );
      if (
        typeof result.path !== "string" ||
        !result.inspection ||
        typeof result.inspection !== "object"
      )
        throw Error(
          "The server did not return an inspected project. No optimization was started.",
        );
      if (version !== generation.current) return;
      setPath(result.path);
      setDiscoveryPath(result.path);
      setDiscovery(result.inspection);
      setUpload({
        name: file.name,
        warnings: Array.isArray(result.warnings)
          ? result.warnings.map(String)
          : [],
      });
      setHint(
        "ZIP inspected. Review compatibility, then trust the project before optimizing.",
      );
    } catch (e) {
      if (version === generation.current && e.name !== "AbortError") {
        setError(e.message || String(e));
        setHint("");
      }
    } finally {
      if (version === generation.current) {
        setScanning(false);
        request.current = null;
      }
    }
  }
  function drop(e) {
    e.preventDefault();
    depth.current = 0;
    setDragging(false);
    if (locked) return;
    const files = [...e.dataTransfer.files],
      zip = files.find((f) => /\.zip$/i.test(f.name));
    if (zip && files.length === 1) {
      uploadZip(zip);
      return;
    }
    setChanging(true);
    const text = e.dataTransfer.getData("text/plain").trim();
    if (text.startsWith("/") || text.startsWith("file://")) {
      try {
        resetSource(decodeURI(text.replace(/^file:\/\//, "")));
      } catch {
        setError(
          "That folder path could not be read. Paste its full local path.",
        );
      }
      return;
    }
    const entry = [...e.dataTransfer.items]
      .find((i) => i.kind === "file")
      ?.webkitGetAsEntry?.();
    const name = entry?.name || files[0]?.name;
    if (!name) return;
    resetSource();
    if (cadPattern.test(name))
      setHint(
        "This form opens runnable Vite + Three.js projects. A CAD/model file is not a web project; upload your project ZIP here.",
      );
    else if (entry?.isDirectory)
      setHint(
        `Your browser cannot reveal the location of “${name}”. Zip that folder and upload it, or paste its full local path below.`,
      );
    else
      setHint(
        "Upload one project ZIP, or paste a local folder path. Single source files cannot be opened as a complete project.",
      );
    setTimeout(() => input.current?.focus(), 0);
  }
  function submit(e) {
    e.preventDefault();
    if (locked) return;
    if (!existing && (!compatible || !trusted)) {
      setError(
        "Inspect a supported project and confirm that you trust its code before optimizing.",
      );
      return;
    }
    if (!providerConfigured) {
      setError(
        "Configure the backend model connection before starting an AI run.",
      );
      onSettings?.();
      return;
    }
    const box = (
      e.nativeEvent.submitter || e.currentTarget
    ).getBoundingClientRect();
    setError("");
    onOptimize(existing ? null : { path: path.trim(), trusted: true }, {
      x: box.left + box.width / 2,
      y: box.top + box.height / 2,
    });
  }
  return (
    <form
      className={"glow glow-edge intake " + (dragging ? "is-dragging" : "")}
      aria-label="Open your project and optimize"
      onSubmit={submit}
      onDragEnter={(e) => {
        e.preventDefault();
        if (!locked) {
          depth.current++;
          setDragging(true);
        }
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
            disabled={locked}
            onClick={() => {
              setChanging(true);
              resetSource();
            }}
          >
            Change
          </button>
        </div>
      ) : (
        <>
          <div className="intake-drop">
            <FolderUp size={24} aria-hidden="true" />
            <div>
              <b>Open your 3D web project</b>
              <span>Upload a ZIP, or inspect a folder on this machine.</span>
            </div>
          </div>
          <input
            ref={picker}
            type="file"
            accept=".zip,application/zip"
            aria-label="Choose project ZIP"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              uploadZip(file);
            }}
          />
          <div className="path-row">
            <button
              type="button"
              className="secondary-button"
              disabled={locked}
              onClick={() => picker.current?.click()}
            >
              {scanning && !path ? (
                <Loader2 size={14} className="spin" />
              ) : (
                <Upload size={14} />
              )}{" "}
              {upload ? "Replace ZIP" : "Upload project ZIP"}
            </button>
            {upload && (
              <button
                type="button"
                className="link-button"
                disabled={locked}
                onClick={() => resetSource()}
              >
                Use local folder
              </button>
            )}
          </div>
          {upload ? (
            <div className="intake-project">
              <FolderUp size={19} />
              <div>
                <b>{upload.name}</b>
                <span>Uploaded project · awaiting your trust</span>
              </div>
            </div>
          ) : (
            <>
              <label className="visually-hidden" htmlFor="project-path">
                Local project folder path
              </label>
              <div className="path-row">
                <div className="glow glow-focus field-box">
                  <input
                    id="project-path"
                    ref={input}
                    placeholder="/Users/you/projects/my-scene"
                    value={path}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={locked}
                    onChange={(e) => resetSource(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!path.trim() || locked}
                  onClick={scan}
                >
                  {scanning ? <Loader2 size={14} className="spin" /> : null}
                  Inspect
                </button>
              </div>
            </>
          )}
          <p className="intake-kinds">
            Vite + Three.js · ZIP up to 20 MiB · include package.json and
            source; exclude node_modules
          </p>
          {hint && (
            <p className="intake-note" role="status">
              {scanning && <Loader2 size={14} className="spin" />} {hint}
            </p>
          )}
          {discovery && (
            <div
              className={"intake-note " + (compatible ? "good" : "bad")}
              role="status"
            >
              <b>
                {compatible ? <Check size={14} /> : <TriangleAlert size={14} />}
                {compatible
                  ? "Supported project"
                  : "Compatibility needs attention"}
                {discovery.name ? " · " + discovery.name : ""}
              </b>
              <span>
                {discovery.framework || "Unknown framework"}
                {discovery.threeVersion
                  ? " · Three.js " + discovery.threeVersion
                  : ""}
                {discovery.entryPoints?.length
                  ? " · Entry: " + discovery.entryPoints.join(", ")
                  : ""}
              </span>
              {!compatible && (
                <small>
                  Optimization is disabled until inspection confirms a supported
                  project.
                </small>
              )}
              {discovery.issues?.slice(0, 4).map((issue, i) => (
                <small key={i}>
                  {typeof issue === "string"
                    ? issue
                    : issue.message ||
                      issue.detail ||
                      "Inspect the project configuration."}
                </small>
              ))}
              {upload?.warnings.slice(0, 3).map((warning, i) => (
                <small key={"upload-" + i}>{warning}</small>
              ))}
            </div>
          )}
        </>
      )}
      <label className="intake-goal" htmlFor="goal">
        <span>What feels slow?</span>
        <div className="glow field-box">
          <textarea
            id="goal"
            rows={2}
            maxLength={4000}
            value={mission}
            placeholder="It stutters when more robots are on screen. Keep it looking and behaving the same."
            onChange={(e) => onMission(e.target.value)}
            disabled={busy || running}
          />
        </div>
      </label>
      {!existing && (
        <label className="intake-trust">
          <input
            type="checkbox"
            checked={trusted}
            disabled={!compatible || locked}
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
      {error && (
        <p className="intake-note bad" role="alert">
          <TriangleAlert size={14} aria-hidden="true" /> {error}
        </p>
      )}
      <button
        type="submit"
        className="optimize"
        disabled={locked || (!existing && (!compatible || !trusted))}
      >
        {busy || scanning ? <Loader2 size={17} className="spin" /> : null}
        {scanning ? "Inspecting project…" : "Optimize"}{" "}
        <ArrowRight size={17} aria-hidden="true" />
      </button>
      {!existing && !compatible && (
        <p className="intake-preview">
          Inspect first. Sift only builds and runs your project after you trust
          it and choose Optimize.
        </p>
      )}
      {!existing && (
        <p className="intake-examples">
          or try
          {examples.map(([id, title]) => (
            <button
              type="button"
              key={id}
              disabled={locked}
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
