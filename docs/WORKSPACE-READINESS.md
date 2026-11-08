# Integrated Sift workspace — readiness

The default UI is Start → Working → Result. It keeps the actual project scene visible, shows four truthful agent stages, and puts logs, code, metrics and history in Details. The rocket launch and solar-system landing are preserved. Decorative rendering is contained outside the application and pauses during measured work. The original engineering and STL tools remain available through advanced routes; STL autonomous mechanical reassembly is not claimed.

## Run locally

Node22.15+ and Chrome are required. `npm ci`, `npm run build`, `npm start`. Default URL is http://127.0.0.1:4310; set PORT to choose another port. The operator's integration instance is4320. Its retired read-only review on4313 redirects to4320. That redirect is local review-server configuration, not an extra product service to deploy.

Configure the backend model using Model settings or ignored local environment variables. No credentials are shipped. Meta investigation/optimization, SubQ risk review and Fetch handoffs require their documented configuration. The fourth visible stage is the deterministic verifier, not a fourth LLM.

## Connect and run

Upload a ZIP or inspect a server-readable local folder. The ZIP must include package.json and source and be at most20MiB compressed; limits include60MiB expanded,2,000entries and10MiB per file. Dependency/generated/credential paths are excluded. Extraction and inspection do not execute project code. Inspect the compatibility findings, explicitly trust the project, describe the issue, then Optimize.

A trusted missing dependency installation uses the declared project manifest/lock in a dedicated cache, with lifecycle scripts disabled and a sanitized environment. Sift does not silently substitute its own dependency tree for arbitrary projects. Projects that require install scripts, workspaces, non-registry dependencies or private packages may need a prepared local install. Project Vite aliases/plugins are preserved; plugins are not applied twice.

The initial profile is followed by the requested AI optimization, with the exact pending profile/goal saved across refresh in this browser session. A runnable candidate is Testing until evidence exists. Failed correctness preserves the original; a visible failure is not successful optimization. Camera/time synchronization depends on instrumentation support. Apply is separate from accepted workspace promotion.

## Compatibility is checked, not universal

Automatic integration targets standalone Vite applications using a supported Three.js WebGLRenderer module. It does not require the authored Relay simulator or a handwritten adapter. Tested: Three0.181.x automatic plain scene with actual click selection, camera synchronization and deterministic stepping; a separately installed Three0.170.0 named-import app with96moving objects; custom Vite aliases/plugins. These checks do not certify every Three.js version, React Three Fiber project, WebGPU app, remote-asset application, custom physics engine or monorepo.

The browser profiler blocks external requests during protected measurements. Projects requiring network assets/API responses need a local deterministic asset/state harness. Unsupported renderers or missing exports should fail with compatibility/build errors; no fake optimization runs are substituted. A valid project can produce a rejected or inconclusive experiment, or have no useful optimization. Sampled verification is not a guarantee of all behavior.

## Verification record

- Real browser ZIP→inspection→trust→dependency install→profile→refresh→AIrun exercised on projectaace391c-425, run87849f84-93a. Candidate was genuinely rejected for protected transform changes; original preserved.
- A second uploaded-project run, `f70874f8-3b9` / `676c15a0-aef`, accepted the actual candidate:6,009→12draw calls, CPU submission p95 19.6→1.8ms,16checkpoints. Candidate selection/dispatch and browser patch download passed. See verification/zip-workflow.json and verification/continuous-workspace-verified.png.
- Earlier integration runsed8c0f4f-124 and2f070345-93f accepted measured Relay improvements, with16checkpoints and80picking probes; use the specific run's receipt for numbers.
- Compatibility evidence: verification/project-compatibility.json; automatic bridge smoke: tests/spatial-runtime-live.mjs.
- Node suite covers archive security, hosted sessions, dependency isolation, API failures, pending-profile recovery, Vite config preservation, agent activity, snapshot/diff validation and existing verification/repair behavior.

## Deployment preparation

See [HOSTED-DEPLOYMENT.md](HOSTED-DEPLOYMENT.md). Docker/Railway configuration includes the web+worker runtime, Chromium, Python/Fetch environment, persistent storage, host/port configuration, health checks and fail-closed operator access. The container has NOT been built/deployed/tested here. This is a trusted-operator service, not an untrusted multi-tenant sandbox. Hosted opaque iframe/cookie behavior, software-rendered measurements, restart persistence and the complete public-URL ZIP run must still be verified before claiming hosted readiness.

Do not merge or deploy automatically. Teammate attribution remains in the integration merge commits; unfinished feature changes stay isolated from main.

Deployment preflight also exercised real HTTP login/session/API denial and managed-path restrictions locally (`node scripts/verify-hosted-access.mjs`); this made zero model calls and ran no uploaded code. Container build attempt failed at Docker's own temporary-directory creation with an input/output error, before the Dockerfile ran. Docker storage must be repaired or the image built in a healthy environment before deployment can be verified.

Final local Node suite:164passed,0failed. Fetch Python tool tests:5passed. Production frontend build passed. Original project source was not applied/overwritten during testing.
