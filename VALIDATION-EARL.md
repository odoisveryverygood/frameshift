# Earl verification — November 7, 2026

This is an incremental upgrade of the pre-existing FrameShift application. Git
timestamps establish when changes were made; they do not establish eligibility
under an event's new-work rules. Do not describe prior work as event-built work.

## Executed checks

- `npm test`: 31 passing tests covering source tools, exact patches, provider
  transports, mission propagation/repair, discovery, isolation, repeated metrics,
  policy continuity, local CLI parsing, and independent verdict receipts.
- `npm run build`: production UI build passes.
- `npm run verify`: all 9 integration checks pass: import, cross-origin rejection,
  real build/browser profile, patch export, explicit application with exact backup,
  conflict rejection, cancellation, artifact protection, and disconnect/history.
- CLI: existing-server reuse, a fresh-server startup on port 4322, and `--fresh`
  reconnection were exercised. The temporary web server was stopped.
- Controlled SIGKILL of an idle worker caused the running starter to launch a
  replacement automatically. See `verification/earl-worker-recovery.json`.
  This check establishes replacement, not active-job crash recovery.

## Live mission through the browser

Run `c464c35a-259` connected an authored plain Vite/Three.js application containing
400 animated cells. No handwritten adapter was present. A mission entered in the
browser requested fewer draw calls while preserving animation and click selection.
One recorded click was added to the verification scenario.

The live model inspected source with tools and proposed an instancing patch.

| Result | Reference | Accepted candidate |
|---|---:|---:|
| Draw calls | 400 | 2 |
| CPU update/render submission p95 | 3.0 ms | 0.6 ms |
| Frame interval p95 | 16.8 ms | 16.8 ms |
| Triangles | 4,800 | 4,800 |

Eight checkpoints, 400 semantic objects, 40 picking probes, and the recorded
interaction passed. A second candidate was inconclusive and was not promoted.
This is an authored fixture on one Mac, not independent customer validation,
a frame-rate multiplier, or a claim of universal application equivalence.
Raw summaries and guards are in `verification/earl-live-run.json`.

The run generated evidence/policy receipts. Source/patch provenance hardening
was added afterward. `verification/earl-source-receipt.json` checks the updated
verifier using a copy of the second experiment's existing evidence and its actual
source workspaces. It is a re-evaluation, not another live benchmark or model run.

## UI checks

The real warehouse workspace and the completed live mission were inspected in a
browser. Review was corrected so title, paired metrics, guard evidence, patch,
and receipt refer to the same accepted experiment. Desktop and 390px mobile
layouts were checked without horizontal overflow. The mobile scene's framing
depends on the connected application's own responsive camera handling.

- `verification/earl-workspace.png`: real connected warehouse application.
- `verification/earl-mobile.png`: mobile workspace.
- `verification/earl-empty.png`: isolated no-project UI fixture, not a real run.

## Boundaries

Automatic integration targets local Vite + Three.js WebGL projects with installed
dependencies. Native Meta-provider access, arbitrary frameworks, GPU utilization,
hosted multi-user execution, and held-out adoption of agent skill revisions are
not established. The primary theme connection is independent verification.
Build restrictions and receipts are not an audited hostile-code sandbox.
