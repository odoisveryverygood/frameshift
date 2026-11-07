import React, { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  Download,
  FileBox,
  Loader2,
  TriangleAlert,
  Upload,
} from "lucide-react";

const SMALL_BYTES = 40 * 1024 * 1024;
const MAX_BYTES = 768 * 1024 * 1024;
const units = {
  mm: "Millimeters",
  cm: "Centimeters",
  m: "Meters",
  in: "Inches",
};
const number = (value) =>
  Number.isFinite(value) ? value.toLocaleString() : null;
function firstNumber(...values) {
  return values.find(Number.isFinite);
}
function issueText(item) {
  return typeof item === "string"
    ? item
    : item?.message || item?.description || item?.code || "";
}

export default function StlImport({ busy = false, onConnected }) {
  const input = useRef(null),
    request = useRef(null);
  useEffect(() => () => request.current?.abort(), []);
  const [file, setFile] = useState(null),
    [unit, setUnit] = useState("mm");
  const [uploading, setUploading] = useState(false),
    [opening, setOpening] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(null),
    [uploadPhase, setUploadPhase] = useState("uploading");
  const [error, setError] = useState(""),
    [result, setResult] = useState(null),
    [dragging, setDragging] = useState(false);
  const working = busy || uploading || opening;
  const largeFile = Boolean(file && file.size > SMALL_BYTES);
  function choose(value) {
    setError("");
    setResult(null);
    if (!value) return;
    if (!/\.stl$/i.test(value.name)) {
      setFile(null);
      setError(
        "Choose an STL file. Other CAD formats are not supported by this importer.",
      );
      return;
    }
    if (!value.size) {
      setFile(null);
      setError(
        "This file is empty. Export the model again and choose the new STL.",
      );
      return;
    }
    if (value.size > MAX_BYTES) {
      setFile(null);
      setError(
        "This STL is larger than 768 MB. Export a smaller binary STL or an individual component.",
      );
      return;
    }
    setFile(value);
  }
  async function analyze(event) {
    event?.preventDefault();
    if (!file || working) return;
    setUploading(true);
    setError("");
    setResult(null);
    request.current?.abort();
    request.current = new AbortController();
    try {
      setUploadPercent(null);
      setUploadPhase("uploading");
      const data = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const signal = request.current.signal;
        const abort = () => xhr.abort();
        const clean = () => signal.removeEventListener("abort", abort);
        xhr.open(
          "POST",
          `/api/stl/import?filename=${encodeURIComponent(file.name)}&units=${encodeURIComponent(unit)}`,
        );
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.responseType = "json";
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable)
            setUploadPercent(
              Math.min(100, Math.round((event.loaded / event.total) * 100)),
            );
        };
        xhr.upload.onload = () => {
          setUploadPercent(100);
          setUploadPhase("scanning");
        };
        xhr.onload = () => {
          clean();
          if (xhr.status >= 200 && xhr.status < 300)
            resolve(xhr.response || {});
          else
            reject(
              Error(
                xhr.response?.error || `STL import failed (${xhr.status}).`,
              ),
            );
        };
        xhr.onerror = () => {
          clean();
          reject(
            Error(
              "The upload could not reach Earl's local service. Check that Earl is running and retry.",
            ),
          );
        };
        xhr.onabort = () => {
          clean();
          reject(new DOMException("Upload cancelled", "AbortError"));
        };
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) {
          clean();
          reject(new DOMException("Upload cancelled", "AbortError"));
          return;
        }
        xhr.send(file);
      });
      const imported = data.import || data;
      if (!imported.id || !imported.report)
        throw Error(
          "The importer returned an incomplete repair report. No model was opened.",
        );
      setResult(imported);
    } catch (failure) {
      if (failure.name !== "AbortError")
        setError(failure.message || "STL upload failed.");
    } finally {
      setUploading(false);
    }
  }
  async function openRepaired() {
    if (!result || working) return;
    setOpening(true);
    setError("");
    request.current?.abort();
    request.current = new AbortController();
    try {
      const response = await fetch(
        `/api/stl/imports/${encodeURIComponent(result.id)}/connect`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ useRepaired: true, mode:'repair' }),
          signal: request.current.signal,
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw Error(data.error || "The repaired model could not be opened.");
      if (!data.project?.id)
        throw Error("The importer did not return a connected project.");
      await onConnected(data);
    } catch (failure) {
      if (failure.name !== "AbortError")
        setError(failure.message || "The model could not be connected.");
    } finally {
      setOpening(false);
    }
  }
  const report = result?.report || {},
    counts = report.counts || report.summary || {};
  const inputCount = firstNumber(
    report.inputTriangles,
    report.originalTriangles,
    report.inputFacets,
    counts.inputTriangles,
    counts.inputFacets,
  );
  const outputCount = firstNumber(
    report.outputTriangles,
    report.repairedTriangles,
    report.outputFacets,
    counts.outputTriangles,
    counts.outputFacets,
  );
  const boundaryEdges = firstNumber(
    report.boundaryEdges,
    report.topology?.boundaryEdges,
    counts.boundaryEdges,
  );
  const nonManifold = firstNumber(
    report.nonManifoldEdges,
    report.topology?.nonManifoldEdges,
    counts.nonManifoldEdges,
  );
  const components = firstNumber(
    report.connectedComponents,
    report.components?.length,
    report.topology?.connectedComponents,
    counts.connectedComponents,
  );
  const changes = [
    [
      "Zero-area facets removed",
      firstNumber(
        report.removedDegenerate,
        report.repairs?.removedDegenerate,
        counts.removedDegenerate,
      ),
    ],
    [
      "Non-finite facets removed",
      firstNumber(
        report.removedNonFinite,
        report.repairs?.removedNonFinite,
        counts.removedNonFinite,
      ),
    ],
    [
      "Duplicate facets removed",
      firstNumber(
        report.removedDuplicate,
        report.repairs?.removedDuplicate,
        counts.removedDuplicate,
      ),
    ],
    [
      "Facet normals recalculated",
      firstNumber(
        report.recalculatedNormals,
        report.repairs?.recalculatedNormals,
        counts.recalculatedNormals,
      ),
    ],
  ].filter(([, value]) => Number.isFinite(value));
  const issues = [
    ...(Array.isArray(report.issues) ? report.issues : []),
    ...(Array.isArray(report.warnings) ? report.warnings : []),
  ]
    .map(issueText)
    .filter(Boolean);
  const dimensions =
    Array.isArray(report.bounds?.size) &&
    report.bounds.size.length === 3 &&
    report.bounds.size.every(Number.isFinite)
      ? report.bounds.size
      : null;
  const previewUrl =
    typeof result?.previewUrl === "string" &&
    result.previewUrl.startsWith("/stl-preview/")
      ? result.previewUrl
      : null;
  const originalUrl =
    result?.originalDownloadUrl || result?.downloads?.original;
  const repairedUrl =
    result?.repairedDownloadUrl || result?.downloads?.repaired;
  return (
    <div className="stl-import">
      {!result ? (
        <form onSubmit={analyze}>
          <p className="stl-intro">
            Open your robot’s surface mesh. Earl keeps the original and reports
            recoverable mesh repairs before you use the result.
          </p>
          <input
            ref={input}
            id="stl-file"
            className="stl-file-input"
            type="file"
            accept=".stl"
            disabled={working}
            onChange={(event) => choose(event.target.files?.[0])}
          />
          <label
            htmlFor="stl-file"
            className={
              "stl-dropzone" +
              (dragging ? " is-dragging" : "") +
              (working ? " is-disabled" : "")
            }
            onDragOver={(event) => {
              event.preventDefault();
              if (!working) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              if (!working) choose(event.dataTransfer.files?.[0]);
            }}
          >
            {file ? (
              <FileBox size={25} strokeWidth={1.4} />
            ) : (
              <Upload size={25} strokeWidth={1.4} />
            )}
            <strong>{file ? file.name : "Choose your robot STL"}</strong>
            <span>
              {file
                ? `${(file.size / 1024 / 1024).toFixed(2)} MB · click to choose another file`
                : "Drop a file here or click to browse · ASCII or binary · up to 768 MB"}
            </span>
          </label>
          {largeFile && (
            <p className="stl-footnote">
              Large binary STL: Earl scans the full file and creates a lighter
              overview for navigation. Full topology, duplicate-facet and
              winding analysis are not performed in this mode.
            </p>
          )}
          <label className="stl-unit-label">
            Export units
            <select
              aria-label="STL export units"
              value={unit}
              disabled={working}
              onChange={(event) => setUnit(event.target.value)}
            >
              {Object.entries(units).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <p className="stl-footnote">
            STL does not identify the export units, joints, or named robot
            parts. Use the units chosen in your CAD export.
          </p>
          <button
            className="primary-button full"
            disabled={!file || working}
            type="submit"
          >
            {uploading ? (
              <>
                <Loader2 size={15} className="spin" />
                {uploadPhase === "uploading"
                  ? `Uploading${uploadPercent == null ? "…" : ` ${uploadPercent}%`}`
                  : largeFile
                    ? "Scanning full file…"
                    : "Inspecting mesh…"}
              </>
            ) : (
              <>
                Inspect & repair
                <ArrowRight size={15} />
              </>
            )}
          </button>
          {uploading && uploadPhase === "scanning" && (
            <p className="stl-footnote" role="status">
              {largeFile
                ? "Upload complete. The full-file binary scan may take a while. Keep this window open; the overview has not been accepted yet."
                : "Upload complete. Earl is inspecting the mesh and building its preview."}
            </p>
          )}
        </form>
      ) : (
        <div className="stl-review">
          <div className="stl-review-heading">
            <span>
              {report.requiresReview ? (
                <TriangleAlert size={16} />
              ) : (
                <Check size={16} />
              )}
              {report.requiresReview
                ? "Mesh needs review"
                : "Mesh inspection complete"}
            </span>
            <button
              className="subtle-button"
              disabled={working}
              onClick={() => {
                setResult(null);
                setError("");
              }}
            >
              Choose another STL
            </button>
          </div>
          <h3>
            {result.filename || result.name || file?.name || "Robot mesh"}
          </h3>
          <p className="stl-footnote">
            Review what changed. A readable mesh is not a mechanical,
            structural, or manufacturing certification.
          </p>
          {previewUrl && (
            <figure className="stl-mesh-preview">
              <iframe
                sandbox="allow-scripts"
                src={previewUrl}
                title={
                  report.previewOnly
                    ? "STL model overview"
                    : "Repaired STL mesh preview"
                }
              />
              <figcaption>
                {report.previewOnly
                  ? "Lighter overview · not the full mesh or topology verification"
                  : "Repaired mesh preview · not mechanical validation"}
              </figcaption>
            </figure>
          )}
          {report.previewOnly && (
            <div className="stl-review-issues">
              <TriangleAlert size={15} />
              <div>
                <p>
                  This is a reduced overview for navigation. The full retained
                  mesh stays in the repaired STL download.
                </p>
                <p>
                  Full topology, duplicate-facet and winding analysis are
                  unassessed. Full-model agent optimization is disabled for this
                  overview.
                </p>
              </div>
            </div>
          )}
          <div className="stl-facts">
            {Number.isFinite(inputCount) && (
              <div>
                <span>Input triangles</span>
                <b>{number(inputCount)}</b>
              </div>
            )}
            {Number.isFinite(outputCount) && (
              <div>
                <span>Retained triangles</span>
                <b>{number(outputCount)}</b>
              </div>
            )}
            {report.previewOnly && Number.isFinite(report.previewTriangles) && (
              <div>
                <span>Overview triangles</span>
                <b>{number(report.previewTriangles)}</b>
              </div>
            )}
            {Number.isFinite(components) && (
              <div>
                <span>Geometric components</span>
                <b>{number(components)}</b>
              </div>
            )}
            <div>
              <span>Export units</span>
              <b>{units[result.units || unit] || result.units || unit}</b>
            </div>
            {dimensions && (
              <div className="stl-dimensions">
                <span>Mesh bounds · X × Y × Z</span>
                <b>
                  {dimensions
                    .map((n) => Number(n.toPrecision(5)).toLocaleString())
                    .join(" × ")}{" "}
                  {report.units || result.units || unit}
                </b>
              </div>
            )}
          </div>
          {!!changes.length && (
            <div className="stl-repairs">
              <span className="overline">REPORTED REPAIRS</span>
              {changes.map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <b>{number(value)}</b>
                </div>
              ))}
            </div>
          )}
          {(Number.isFinite(boundaryEdges) || Number.isFinite(nonManifold)) && (
            <div className="stl-topology">
              <span className="overline">REMAINING TOPOLOGY</span>
              {Number.isFinite(boundaryEdges) && (
                <p>{number(boundaryEdges)} boundary edges</p>
              )}
              {Number.isFinite(nonManifold) && (
                <p>{number(nonManifold)} non-manifold edges</p>
              )}
            </div>
          )}
          {!!issues.length && (
            <div className="stl-review-issues">
              <TriangleAlert size={15} />
              <div>
                {issues.slice(0, 8).map((issue, i) => (
                  <p key={i}>{issue}</p>
                ))}
              </div>
            </div>
          )}
          {report.largeMesh &&
            Array.isArray(report.limitations) &&
            report.limitations.length > 0 && (
              <details className="stl-topology">
                <summary>Large-file scan limits</summary>
                {report.limitations.map((item, i) => (
                  <p key={i}>{issueText(item)}</p>
                ))}
              </details>
            )}
          <p className="stl-footnote">
            Missing surfaces and ambiguous geometry remain flagged. Earl does
            not invent mechanical parts or certify a watertight result.
          </p>
          {(originalUrl || repairedUrl) && (
            <div className="stl-downloads">
              {originalUrl && (
                <a href={originalUrl} download>
                  <Download size={13} />
                  Original STL
                </a>
              )}
              {repairedUrl && (
                <a href={repairedUrl} download>
                  <Download size={13} />
                  {report.previewOnly ? "Full retained STL" : "Repaired STL"}
                </a>
              )}
            </div>
          )}
          <button
            className="primary-button full"
            disabled={
              working ||
              report.status === "unrecoverable" ||
              result.status === "rejected"
            }
            onClick={openRepaired}
          >
            {opening ? (
              <>
                <Loader2 size={15} className="spin" />
                Connecting model…
              </>
            ) : (
              <>
                {report.previewOnly
                  ? "Open repair workspace"
                  : "Open repair workspace"}
                <ArrowRight size={15} />
              </>
            )}
          </button>
          <small className="stl-footnote">
            This opens the local alignment workspace. Your
            original STL stays unchanged.
          </small>
        </div>
      )}
      {error && (
        <div className="problem stl-error" role="alert">
          <TriangleAlert size={15} />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
