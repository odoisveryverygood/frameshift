# FrameShift 0.2 verification

Verified locally on November 7, 2026, on the available Apple M4 machine.

Implemented and checked:
- New porcelain/blue-ink/cobalt interface inspired by the user's actual local
  Morf workspace. One dominant scene, three stages, contextual inspector, details
  in drawers, and a new “Less work per frame” tagline.
- Framework/entry/dependency detection and source graph discovery.
- Automatic Vite instrumentation on an independent authored plain Three.js
  project with no frameshift.config.json and no handwritten adapter.
- Actual source-tool calls, exact targeted patches, inspected-file hashes,
  bounded repair requests, and separate build/verification acceptance.
- Eight scene checkpoints, 40 picking probes, and a recorded real canvas click
  with application selection-output comparison in the live imported-project run.
- Alternating A/B and B/A measurements, saved raw samples and repeat variability.
- Independent job worker: a live optimization continued through a web-server
  restart. A deliberately killed worker was replaced; the job resumed its saved
  baseline checkpoint and preserved its interrupted attempt.
- macOS build restrictions: workspace writes succeeded; sibling sentinel reads
  and writes and loopback networking were denied. Provider keys were absent from
  the child environment. Tests did not read any real private files.
- Twenty unit/contract tests passed. Production UI build passed.

## Live automatic-project result

Run f77fc68b-0de automatically imported a plain Vite+Three.js scene. The model
read profile/source tools and made an instancing patch. It passed all eight
checkpoints, 40 picking probes, and the recorded click replay.

Draw calls: 25 → 2. Paired CPU callback/submission p95: 1.1 → 0.6 ms in that run.
These are measurements of an authored local fixture, not an independent customer
application or a broad generalization result. Raw data and source-tool trace are
in verification/v0.2-live-run.json. The unchanged original source stayed outside
the working copy. A later small optimization was inconclusive and was discarded.

## Boundaries

Vite + Three.js WebGL is the automatic integration path. R3F is detected through
its Three renderer; a separate full R3F application was not live-tested here.
Next.js and WebGPU execution are not automatically supported. Application camera
controllers may override synthetic view requests; exact reference camera states
are replayed for candidate screenshots. Guards cover sampled states and recorded
actions, not all possible functionality.

rAF intervals are controlled-harness frame intervals, not completed GPU frames or
guaranteed displayed FPS. CPU callback time is distinct from GPU query time and
energy use. Repeat counts remain small and single-device measurements can vary.
GPU readings are informational; CPU/frame-pacing guards and the selected primary
metric govern acceptance. Historical v0.1 benchmark results remain separate.

The local worker is not a multi-user hosted service. macOS file/network build
restrictions are tested, but this is not an audited hostile-code security system.
Only connect trusted code. Non-macOS execution currently has sanitized process
environment isolation rather than equivalent OS filesystem/network enforcement.
