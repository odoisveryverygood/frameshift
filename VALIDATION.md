# Local verification — November 7, 2026

FrameShift is implemented and exercised as a local, single-user application.
This record describes actual runs on the available Apple M4 machine. It is not
a customer deployment, a cross-device study, or evidence of hackathon eligibility.

## Live autonomous result

Run: `fea029eb-0e2`; accepted experiment: `94548e09-6b9`.
Model: `gpt-5.4`, through the configured OpenAI Responses API.
Workload: the authored warehouse scene, with 1,600 animated semantic objects.
The paired reference already contained earlier accepted geometry/material reuse.

| Measurement | Fresh reference | Accepted candidate |
|---|---:|---:|
| Draw calls | 1,611 | 13 |
| CPU update + render-submission p95 | 3.2 ms | 0.8 ms |
| rAF frame interval p95 | 16.8 ms | 16.8 ms |
| rAF-derived rate | about 59.9 Hz | about 59.9 Hz |
| Triangles | 19,310 | 19,310 |
| GPU timer-query p95, informational | 0.97 ms | 1.64 ms |

The model replaced separate robot draws with two InstancedMesh groups. All
1,600 semantic objects remained. The three configured transform and raycasting
checks passed. Pixel comparison found zero changed pixels in two views and one
changed pixel in the remaining 960×640 view, within the configured tolerance.

This establishes lower draw submissions and lower CPU submission time on this
workload. **It does not establish higher displayed FPS or lower GPU execution
time.** The GPU query reading increased in this run. GPU queries use 12 samples
and are informational in this version; the acceptance gates for this selected
goal protect CPU submission and frame pacing, not GPU time or energy use.

The next model iteration returned no patch because it found no additional safe
reduction in the allowed module. The unchanged version was retained.

Evidence:
- `verification/live-run.json`: complete selected run, excluding transient build log.
- `verification/reference-metrics.json` and `candidate-metrics.json`: raw samples.
- `verification/guards.json`: visual, transform and picking checks.
- `verification/reference-0.png`, `candidate-0.png`, `diff-0.png`.
- `verification/change.patch`: the accepted instancing experiment.
- `verification/final-optimization.patch`: cumulative changes against original source.

## Genuine rejected AI experiment

An earlier live model proposal shifted robot positions through incorrect
transform arithmetic. Its visual, transform, and picking guards failed. The
candidate was discarded and the best workspace remained unchanged.
`verification/rejected-experiment.json` preserves that actual proposal and outcome.
This was not a scripted failure or the separate verifier negative-control feature.

## Automated checks

- Eight Node tests passed: semantic failure detection, CPU/draw-call acceptance
  gates, measurement aggregation, source path/symlink restrictions, secret-free
  workspace copying, strategy tracking, and both model transport contracts.
- Nine integration checks passed using a separate authored local fixture:
  import; cross-origin write rejection; production build/browser profile;
  patch export; Apply with exact backup; external-edit conflict rejection;
  cancellation; artifact traversal rejection; and disconnect/history retention.
- `npm run build` passed for the production dashboard.
- The included engine probe ran against Three.js 0.181.2 and answered six of its
  seven source-compatibility questions. `verification/engine-probe.json` contains
  the output; unanswered questions are not treated as measurements.
- Spector.js captured 4,856 actual WebGL commands including 1,611 draw commands
  in a separate instrumented session before the instancing acceptance. Captures
  are compressed. A later capture of the accepted scene recorded 82 WebGL commands
  including 13 draw commands; verification/webgl-capture-summary.json records it.
  Instrumented captures are not performance benchmarks.
- Both model transports passed local mock-server tests. OpenAI Responses was
  tested live; a Meta/Llama-hosted compatible endpoint was not tested live.

## Browser verification

The production dashboard, provider settings, comparison frames, verification
images, and run controls were inspected in the browser. The 390-pixel responsive
layout had no horizontal overflow. Desktop evidence and workspace screenshots
are saved alongside the project deliverables.

## Scope and remaining boundaries

- Supported imports are trusted local Vite + Three.js projects with the adapter
  in ADAPTER.md. Arbitrary repositories are not automatically compatible.
- The three included scenes share a similar draw-submission bottleneck. The
  integration fixture tests the import mechanism; it is not an independent
  third-party application or evidence of broad generalization.
- Builds run with the user's OS permissions. Copies isolate rollback state;
  they are not a security sandbox for untrusted projects or model-written code.
- Guards cover configured viewpoints and picking probes. They do not establish
  all possible functionality, all geometry/material properties, or every future
  animation state.
- No physical phone, broad hardware fleet, hosted multi-user service, GitHub
  OAuth/PR flow, or native Meta API has been validated.
- Local state and historical measurements persist across server restarts;
  in-flight jobs are marked interrupted. Automatic resumption is not implemented.
