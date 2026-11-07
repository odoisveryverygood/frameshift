# Teammate 3: project readiness

This contribution adds a read-only project doctor, a standalone authored Orbit Lab
application, and an isolated live smoke check to the existing Earl engine. The
assignment is on `origin/docs/team-assignments`; implementation starts from `main`
on `teammate-3/project-readiness`. The existing optimizer, SDK, verifier, UI and
recorded benchmark artifacts are outside this contribution.

## Fresh checkout setup

Install **Node.js 22.12+** (or a newer supported release), npm, and **Google Chrome**
in its normal location. Earl's current browser harness uses Playwright's `chrome`
channel, not a downloaded Chromium. WebGL2/hardware acceleration must work. Allow
about 150 MB of extra temporary disk space for the smoke check's isolated runtime.
No model provider/key is required for any command below.

From the repository root:

```sh
npm ci
npm ci --prefix examples/orbit-lab
npm run build
npm run build --prefix examples/orbit-lab
node scripts/doctor.mjs examples/orbit-lab
node scripts/doctor.mjs "examples/orbit-lab  " --json
node scripts/readiness-smoke.mjs
```

The demo also runs independently: copy `examples/orbit-lab` anywhere, then run
`npm ci`, `npm run dev`, or `npm run build` inside it. It does not need Earl's parent
`node_modules`, assets, configuration, manual adapter, or a personal machine path.
Its own lockfile pins its build dependencies. Vite binds the dev/preview servers to
loopback. Stop a manually started demo with Ctrl-C.

## Doctor contract and limits

`node scripts/doctor.mjs [project-folder] [--json]` defaults to the current folder.
The text output starts `Earl project doctor: READY` or `BLOCKED`. JSON is a single
object with `schemaVersion`, `ready`, `project`, `findings` and `limits`. Findings
have `code`, `severity` (`info`, `warning`, `error`), `message` and `remediation`.
Exit **0** means no blocking errors; exit **1** means a blocker or usage error.
Warnings remain visible without automatically failing diagnosis.

Checks cover:

- Folder, readable valid package JSON, and package-map shape. Pasted paths ignore
  surrounding whitespace. Missing folders/files and invalid JSON have distinct codes.
- Vite + Three.js WebGL automatic support; Next.js, unknown build systems, missing
  Three.js, and WebGPU imports are reported as blockers for this path.
- Declared production build script, identified entry modules, installed Three.js
  version (observer minimum 0.150.0), and installed direct runtime/dev dependencies.
  An empty `node_modules` folder is insufficient. Ancestor dependency installations
  are allowed, matching Node resolution. Missing entry detection is a warning because
  nonstandard Vite configurations can supply their own entry.
- Node.js 22+ and Chrome executable presence in standard OS locations or PATH.
  The demo's Vite version requires Node 22.12+; use that or newer for setup.

Diagnosis reads files only. It never evaluates package scripts, imports project
code, installs dependencies, calls a model, launches Chrome, or modifies source.
It does not expose environment contents, scripts, dependency URLs, or raw invalid
JSON. It reports installed Three.js versions rather than credential-bearing package
specifications. `/api/inspect` retains its response shape; discovery adds safe error
codes/package validation and an explicit WebGPU incompatibility finding.

Prerequisite readiness does not prove a build will succeed, all transitive package
versions agree, WebGL works, or a custom Chrome location works with the core
browser channel. The live smoke check establishes those boundaries for Orbit Lab.
Manual-adapter projects are outside the doctor's supported automatic-path verdict.

## Local connection CLI

The existing CLI now trims pasted paths, validates project metadata before
starting a persistent service, and optionally emits one JSON result:

```sh
node scripts/open.mjs examples/orbit-lab --no-browser --json
```

Success JSON contains `projectId` and `url`. Errors exit 1 on stderr. `--port 4320`
selects a web port; `--fresh` imports a new snapshot after external edits. Existing
normal text output and browser opening remain the default. Connection trusts the
selected application's build command, as before. It does not itself execute a
profile; opening the UI can request the first build, or callers can use the existing
`POST /api/projects/:id/runs` endpoint with `{ "kind": "profile" }`.

A manual CLI connection intentionally leaves its local service/worker available.
Do not stop another user's service or delete their `.frameshift` state for cleanup.
Use the isolated smoke command below when testing without persistent local changes.
No package scripts, new API routes, runner hooks or shared lockfile changes are
needed for this contribution.

## Live smoke verification

```sh
node scripts/readiness-smoke.mjs
# Optional evidence destination and profile timeout (1–600 seconds):
node scripts/readiness-smoke.mjs --output .frameshift/readiness-evidence --timeout 240
```

The command creates a unique temporary Earl runtime and a demo source copy, selects
an unused loopback port, and launches its own API server and worker with a sanitized
environment. It copies runtime dependencies to respect the existing macOS build
isolation boundary. It never connects to the current Earl instance, reads its job
store, stops its jobs, changes original demo source, or carries credentials into the
copy. A port collision causes failure rather than attaching to the wrong server.

Each successful assertion prints `PASS`. A failed step prints `FAIL <stage>` with a
useful error, writes a failure receipt when setup permits, and exits nonzero.
It checks actual behavior:

1. Doctor accepts the installed demo and trailing whitespace; missing folder returns
   parseable blocked JSON and exit 1.
2. Demo builds inside its own copied directory using its installed Vite executable.
3. Existing `open.mjs` connects the copied project and returns its actual URL/ID.
4. A real queued **profile** completes through the worker and automatic observer,
   with browser samples, draw counts, and a saved baseline screenshot. It does not
   accept HTTP success as proof that a job finished.
5. The real preview has a nonblank rendered canvas and all 240 satellites move.
6. A real mouse click selects Beacon and changes the visible selection output.
7. Pause freezes observed object positions; Resume restarts motion. Button state
   and visible status agree.
8. Resizing to 390 × 844 updates the drawing buffer without horizontal overflow;
   picking still works. Keyboard clear/select work. Browser errors fail the check.

Evidence defaults to `.frameshift/readiness-results/<unique-run>/`: `result.json`,
`baseline.png`, `preview-desktop.png`, `preview-mobile.png`, `demo-build.log`, and
`service.log`. An explicit output folder preserves the same filenames. Logs may
contain local temporary paths; keep runtime evidence private unless reviewed.
The receipt labels this as a live local authored-demo profile and records its limits.
It is not a model-generated optimization or an independently validated speedup.

On success, failure, Ctrl-C or SIGTERM, the script closes its browser, terminates
only its own server/worker (giving the worker time to abort its build/browser), and
removes only its temporary tree. Evidence remains for inspection. You may delete
the specific evidence directory after review. Force-killing the script or losing
power can leave its unique `earl-readiness-*` OS temp directory and owned processes;
inspect those exact resources before manually cleaning them.

## Checks and observed results

Validated locally on November 7, 2026 with Node 24.15.0, macOS, Chrome 156 and an
Apple M5. Temporary-folder unit fixtures check metadata only; they are not presented
as a live run. Live Orbit Lab smoke profiling measured 245 draw calls and collected
180 frame samples over three repeats. Those are baseline measurements, not a speedup.
The smoke's 12 behavior assertions passed with no browser console/runtime errors.
All 43 unit/contract tests, both production builds, changed-file formatting/syntax
checks, the SDK check, and all 10 existing integration checks passed. Both the root
and standalone demo dependency audits reported zero vulnerabilities. The SDK and
integration checks ran in a disposable runtime with their own service/worker and
preserved the repository's historical artifacts.

An intentional `--timeout 1` run also returned exit 1 with a failed-profile-stage
receipt, then cleaned up its service/worker and temporary tree. This is an expected
failure-path assertion, not a successful profile. Normal smoke profiling passed.
An intentional SIGTERM during live preview interactions also exited 1, saved a
failure receipt and cleaned up its isolated browser, server, worker and temp tree.

Run the complete local source checks from the repository root:

```sh
npm test
npm run build
npm run build --prefix examples/orbit-lab
node_modules/.bin/prettier --check scripts/doctor.mjs scripts/open.mjs scripts/readiness-smoke.mjs server/discovery.mjs tests/doctor.test.mjs tests/open.test.mjs examples/orbit-lab docs/team/teammate-3-readiness.md
node scripts/readiness-smoke.mjs
```

The existing `npm run sdk:verify` and `npm run verify` checks also exercise the core
SDK and integration contract. They write historical evidence paths, so run them in
a disposable checkout if those tracked artifacts must be preserved. `verify` needs
an idle Earl service/worker on port 4310. Never point it at another user's live job:
it contains a global stop request. This task runs it only with an isolated service.

There is no configured lint script; changed files use the existing Prettier and
JavaScript syntax checks, with the Vite build covering browser modules. The root
package/lockfile are unchanged. No existing demo or historical evidence is edited.
The new demo uses the already adopted Three.js/Vite stack and authored geometry;
there is no added third-party asset or copied source requiring new attribution.

Not verified: AI optimization/provider access, a winning patch, verifier coverage
for every possible action, Apply on the user's project, sponsor integrations,
third-party app generalization, physical phones, or live Windows/Linux execution.
The live smoke uses core instrumentation unchanged; any failure of that boundary
must be reported to the owner rather than replaced with synthetic results.
