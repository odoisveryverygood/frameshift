import React, { useState } from "react";

// Real reference and candidate screenshots, compared with a drag slider.
export default function BeforeAfter({ runId, experiment: exp, fixture }) {
  const views = Math.max(1, exp?.guards?.checks?.length || 0);
  const [view, setView] = useState(0);
  const [split, setSplit] = useState(50);
  const [missing, setMissing] = useState({});
  const [play, setPlay] = useState(false);
  if (!exp || fixture)
    return (
      <p className="not-recorded">No screenshots were recorded for this run.</p>
    );
  const src = (kind) =>
    `/api/runs/${runId}/artifacts/${exp.id}/${kind}-${view}.png`;
  const gone = missing[view];
  return (
    <div className="before-after">
      {gone ? (
        <p className="not-recorded">
          No screenshots were recorded for checkpoint {view + 1}.
        </p>
      ) : (
        <div className="ba-frame" style={{ "--split": split + "%" }}>
          <img
            src={src("reference")}
            alt={`Reference, checkpoint ${view + 1}`}
            onError={() => setMissing({ ...missing, [view]: true })}
          />
          <img
            className="ba-top"
            src={src("candidate")}
            alt={`Candidate, checkpoint ${view + 1}`}
            onError={() => setMissing({ ...missing, [view]: true })}
          />
          <i className="ba-handle" aria-hidden="true" />
          <span className="ba-label left">Reference</span>
          <span className="ba-label right">Candidate</span>
          <input
            type="range"
            min="0"
            max="100"
            value={split}
            onChange={(e) => setSplit(+e.target.value)}
            aria-label="Reveal candidate"
          />
        </div>
      )}
      {views > 1 && (
        <div className="ba-views" role="group" aria-label="Checkpoint">
          {Array.from({ length: views }, (_, i) => (
            <button
              key={i}
              type="button"
              aria-pressed={view === i}
              onClick={() => setView(i)}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}
      {exp.previewReady && exp.previewUrl && (
        <div className="ba-play">
          {play ? (
            <iframe src={exp.previewUrl} title="Playable candidate" />
          ) : (
            <button
              type="button"
              className="ghost"
              onClick={() => setPlay(true)}
            >
              Play the candidate
            </button>
          )}
        </div>
      )}
    </div>
  );
}
