# Relay — robotics fleet simulator

A standalone, runnable Vite + Three.js project for testing Sift/Earl on an actual source-code optimization task. It runs 2,000 identifiable mobile robots on 20 continuous warehouse routes, with orbit/zoom, individual picking, locate-by-number, pause/resume, reset, playback speed and dispatch assignments.

This is an **authored kinematic simulator**. Robot trajectories and assignment completion are calculated from simulation time. It does not implement physical robot dynamics, ROS, sensor simulation or collision-aware navigation. It is a transparent optimization workload, not customer validation. There are no model calls, fake performance values, artificial sleeps or a preinstalled optimized result in this simulator.

## Connect to Sift / Earl

**Use the project-folder connection, not Robot STL import.** The app needs the source project in this folder, including `package.json`, `frameshift.config.json` and `src/`.

1. Start Sift/Earl on `http://127.0.0.1:4310`.
2. In **Open your project**, paste the absolute path to this extracted folder. Inspect it, confirm you trust its build, and connect.
3. Alternatively, run `npm run connect` in this folder. It connects this specific folder to the local backend and prints its project URL. It never connects arbitrary paths or changes source files.
4. Start a real Optimize run with this goal:

> Optimize the 2,000 moving robots. Preserve their geometry, two fleet colors, deterministic motion, individual selection and dispatch assignment behavior.

The backend runs independently, uses its configured model credentials and performs isolated edits. The simulator itself needs **no API key**. A new machine needs the Earl/Sift backend and its private provider configuration; the ZIP does not include credentials or the backend.

Keep this folder as the original baseline for a live demonstration. An accepted optimization remains in Sift's candidate workspace until you explicitly apply it. Export the patch to demonstrate the deliverable. To repeat a genuinely fresh experiment after applying a patch, extract an untouched copy into a new folder and connect that folder.

## Run independently

Requires Node 22.12+ and npm; Chrome with working WebGL is recommended.

```sh
npm ci
npm run dev
```

Open the localhost URL printed by Vite. Production check:

```sh
npm test
npm run build
npm run preview
```

On the author's machine the source folder reuses already-installed dependencies through a local symlink to avoid another large install. That symlink is **excluded from the ZIP**. Use `npm ci` on another computer.

## Controls

- Drag to orbit; scroll to zoom.
- Click a robot, or enter its number (1–2000) and press **Locate**.
- **Dispatch selected unit** assigns a delivery at the next packing endpoint on its route. The assignment changes to delivered when simulation time reaches that endpoint.
- Pause/resume, reset and speed controls operate the running simulation.
- FPS, CPU submission p95 and draw calls come from actual browser/renderer measurements. A high-refresh or fast machine may retain smooth FPS despite significant CPU/draw-call overhead. No particular FPS gain is promised.

## Source and protected behavior

- `src/fleet.js`: initial straightforward fleet renderer; this is the only AI-editable module. Every robot initially has its own body, deck and wheel assembly. Repeated geometry/material creation and per-object submissions create measurable overhead.
- `src/simulation.js`: deterministic closed routes and identities, independent of the rendering implementation.
- `src/main.js`: application interactions and protected `__frameshift` benchmark adapter. It reads both ordinary meshes and compatible instanced meshes with `userData.semanticIds`.
- `src/warehouse.js`: static warehouse; already batches repeated shelving and floor markings.
- `src/earl-spatial.js`: the project's local scene selection/camera/interaction bridge, copied from the Sift repository. No remote SDK download.
- `frameshift.config.json`: build, editable source and verification configuration. Original source is not overwritten by starting a job.

Controlled benchmark mode `?__frameshift=1` stops the wall-clock animation and hides changing live metric labels, so screenshots and timing measurements can be compared at fixed simulation times. Ordinary standalone use keeps the simulation running.

## Verification

`verification/smoke.json` records a local Chrome check of all 2,000 unique identities, moving and repeatable poses, actual pointer selection, locate, dispatch completion, pause/resume, reset and baseline measurements. `npm test` checks closed-route math and invalid input handling. These tests establish the checked software behavior only.

Sift's source optimizer must separately produce and verify its own candidate. Read any optimization receipt for its actual result and coverage; a successful simulator smoke check does not itself prove an AI improvement.

## Dependencies and attribution

Three.js (MIT), including OrbitControls and BufferGeometryUtils; Vite (MIT). Pinned versions and transitive dependencies are in `package-lock.json`. The Sift scene bridge is included as local source from the same project. No external models, textures, fonts, paid assets or network data are required at runtime.

### Backend compatibility fix included

The first live integration attempt exposed an Earl Investigator limit: reading a multi-module application could consume its seven-round budget before it could correct an invalid final brief. The local backend now permits ten bounded rounds, retains the same evidence checks, and reports rejected tool results. A regression check covers correcting a source citation after round seven.

`compatibility/earl-investigator.patch` contains that small backend fix and its test. If your teammate is using the older backend, apply it **inside the Sift repository**, then restart Sift's worker before testing:

```sh
git apply /absolute/path/to/robotics-simulator/compatibility/earl-investigator.patch
node --test tests/agent.test.mjs
```

Do not apply the patch again if those changes already exist. It does not add credentials, alter acceptance thresholds, or bypass verification. The simulator still runs independently without this patch.

### Executed end-to-end result

On November 7, 2026, the local Meta Investigator and Optimizer produced a real source patch, SubQ selected additional checks, and the independent verifier accepted the candidate after 16 checkpoints. Paired reference/candidate measurements on one machine were **6,009 → 12 draw calls** and **18.3 → 1.5 ms CPU submission p95**. FPS stayed about 60. Additional browser checks confirmed actual pointer selection and dispatch completion in the accepted instanced candidate.

See `verification/optimization.json` for provenance, source fingerprints, metrics, coverage and limitations. The source in this ZIP remains the original unoptimized fleet, so you can run your own experiment; the accepted implementation has not been substituted into `src/fleet.js`.
