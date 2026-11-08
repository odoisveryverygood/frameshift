# Sift — teammate video and project brief

Use this for the one-minute hackathon video. This PR contains documentation only; it does not merge the UI/backend integration or deploy anything. Feature branches and PRs only. Do not push directly to main.

## The product in one sentence

Sift is an AI performance engineer for Three.js applications: it investigates rendering bottlenecks, edits an isolated copy, and keeps a candidate only when independent measurements and configured correctness checks support it.

Our demonstration application is an authored Vite + Three.js warehouse simulator with 2,000 moving robots, individual selection and dispatch behavior. It is a real runnable source project with deliberately inefficient rendering. It is not customer evidence or a physical robotics experiment.

## One-minute script — one main speaker

**0–10 seconds — problem / moving fleet**

“We build robotics simulations. When thousands of robots move, inefficient rendering makes the browser struggle. Finding and fixing that bottleneck usually means profiling and editing code by hand.”

**10–20 seconds — connect / goal**

“This is Sift. We connect a real Three.js project and ask: reduce rendering overhead, but preserve every robot, its movement, selection and dispatch.”

**20–36 seconds — real agent activity / candidate**

“The Investigator reads source and performance evidence. The Optimizer patches an isolated copy. A risk reviewer identifies what could break. Then an independent verifier builds the candidate, replays checks and measures both versions.”

**36–51 seconds — measured result / interaction**

“In this recorded run, draw calls fell from 6,009 to 12, and CPU submission time fell from 19.1 to 1.3 milliseconds. All sixteen checkpoints and eighty picking probes passed. We can still select and dispatch a robot.”

**51–60 seconds — patch / close**

“We inspect the actual patch and evidence before applying it. Sift turns an AI suggestion into a playable, measured improvement—with failed experiments rejected rather than presented as success.”

Read naturally and time the recording. Shorten the opening if necessary. If the displayed run differs, replace the numbers with THAT run’s receipt.

## What to record

1. Show the moving fleet, then locate a robot and demonstrate selection.
2. Show the project and a specific goal; start a fresh job on the working backend.
3. Show actual Investigator/Optimizer/risk/verification events. Compress the wait with a cut labeled “Run shortened.” Do not imply a 90-second job completed instantly.
4. Show the candidate and its sealed verifier receipt. Keep run identity and measurement labels visible.
5. Locate AMR 1188 in Candidate and dispatch it. Show the assignment change.
6. Show the actual source diff, then the available Apply/download control. Do not claim original source was modified unless Apply actually ran.

Use screen recordings of executed behavior. A previously completed run is fine if labeled “Recorded run”; never present it as a new live run. Rocket/solar-system visuals may illustrate the workflow, but must not fabricate progress or geometry edits.

## Verified integration rehearsal — exact evidence

November 7, 2026, local integration backend:

- Project: `592639ac-b54` — Relay live · integration rehearsal.
- Run: `ed8c0f4f-124`; experiment: `5e027a77-882`.
- Status: completed; experiment accepted by the deterministic verifier.
- Draw calls: **6,009 → 12**.
- CPU submission p95: **19.1 → 1.3 ms**.
- Frame p95: **16.8 → 16.7 ms**. The scene was already near refresh cadence; do not claim a dramatic FPS increase.
- GPU p95: **3.89 → 2.00 ms**, scoped to this configured local measurement.
- Triangles: **310,966 → 310,966**.
- **16/16 checkpoints, 2,000 semantic objects, 80 picking probes**.
- Policy hash: `bf31bb1ea7ecd9a909c48a8b87a3119be67c7d58a5a5b1f65e9b6c909e45af33`.
- Manually exercised Candidate: Locate AMR 1188, then Dispatch; assignment changed to “Packing / en route.”

Results are from this workload and machine. CPU submission time is not total frame time or GPU utilization. Passing sampled checks is not a guarantee of all possible behavior.

Operator-local results URL (not a public teammate link):
`http://127.0.0.1:4320/?project=592639ac-b54&run=ed8c0f4f-124&view=results`

Receipt endpoint on that same running operator backend:
`/api/runs/ed8c0f4f-124/experiments/5e027a77-882/verdict`

Runtime artifacts remain private/ignored locally; they are not included in this docs PR. Teammates need the operator’s recording or their own executed run. A localhost address on another computer does not reach this machine.

## Four visible stages and sponsor responsibilities

| Stage / integration | Actual responsibility | Honest explanation |
| --- | --- | --- |
| Argus / Investigator | Inspect relevant source and measured evidence; form a bounded hypothesis. | Meta powered the tested performance investigation. |
| Vulcan / Optimizer | Use source tools, make a focused patch in an isolated candidate, build/repair failures. | Meta powered the tested optimization; this is an executed tool workflow, not a chat-only answer. |
| Oracle / risk reviewer | Assess patch risks and propose additional protected checkpoints. | Subquadratic/SubQ supplied risk assessment; it does not decide acceptance. |
| Aegis / verifier | Execute builds, visual/state/picking checks and paired benchmarks; issue the verdict. | Deterministic code, not a fourth LLM. |
| Fetch uAgents | Carry typed, revision-bound specialist handoffs with job/attempt/artifact checks. | Local handoffs were used in the optimization pipeline. |
| Agentverse + ASI:One | Public chat/mailbox entry into explicitly authorized project tools. | A separate earlier ASI conversation exercised projects → optimize → status → evidence → patch. This does not prove every new project is publicly allowlisted. |
| Google / Argon | Optional visual investigation path for selected scene context. | Do not claim Argon powered this Relay run. Access/configuration and a specific successful trace must be checked before making that claim. |

The public Fetch identity is `@sift-3d`, address:
`agent1qvcmanw7c86q7sasfqvkz4mc8ex2vhp26059kgyhq3au3ej3hhf4x8g85gp`.

Earlier ASI workflow evidence: project `d9897549-b62`, job `b757fab2-e17`, retrieved 3,047-byte patch with SHA-256 `ae5e308efe3c65bb472cf4c5b854bc048b9dd35c3e92b394e12ca38649725268`. Mailbox and local execution processes must remain running. Public discovery is distinct from local handoff dispatch.

No automatic sponsor-prize eligibility or win is claimed. Event and Fetch submission routes still need their respective final submission steps; the video itself is not a submission.

## Agentic behavior to explain to judges

The agents inspect evidence, select an experiment, call tools, modify source, respond to build/test failures, and hand work across checked boundaries. The verifier has separate acceptance authority. An LLM cannot simply label its own patch “verified.” Unsuccessful candidates are rejected; accepted workspace changes are distinct from explicitly applying a patch to the original project.

Investigation, patching, risk review and verification have dependencies; they do not all perform independent edits at the same instant. Show which stage is actually active rather than making all four appear busy.

## UI direction agreed, not fully delivered

The target is one continuous experience:

- Start: project + one prompt + Optimize, with the rocket.
- Working: rocket launch transitions to a solar system around the actual scene, four contextual stages, one short current action per stage.
- Result: same workspace, Original / Improved, verified measurements/checks, Apply or download; code/logs/history in one Details drawer.

During benchmarks, expensive decorative rendering pauses with an explanation; stages remain visible. Geometry only changes when a real runnable candidate exists. Instancing often preserves appearance, so a truthful explanation highlights regrouping rather than inventing new robot parts.

Current integration combines teammate UI, readiness tools and owner backend in an isolated worktree. It is unfinished and not merged. Existing alternate results/engineering screens remain confusing; visual simplification and the transition sequence still need work. Do not describe the proposed experience as already complete.

## Known issues and scope boundaries

- Port **4313 is the read-only UI review server**. It rejects Inspect/Optimize POSTs; its plain-text rejection caused “Unexpected token R … not valid JSON.” Seeing an old accepted result there does not mean a new run executed.
- Port **4320 is the operator’s working integration backend**, with independent worker. Port 4310 is the older owner app. These are local services, not deployments.
- The fresh `sift-robot-test` source project starts unoptimized; dependencies were installed locally. The ZIP has no API keys. A teammate must run `npm ci` in their extracted copy.
- Hosted project ZIP upload is **not implemented/verified**. Current performance connection uses a server-readable local folder path. A public server cannot read a path on a visitor’s laptop.
- No production/public deployment has been verified. Hosted execution still requires build/browser/worker/storage configuration and an actual end-to-end upload test.
- Real geometry Changes capture is bounded and can omit unsupported meshes/material features. Its current-camera whole-frame counters are diagnostic, not the protected benchmark receipt.
- STL import, cleanup and constrained alignment/export are separate tools. Autonomous recognition and mechanically correct reattachment of a detached intake are **not demonstrated**. Do not center this video on that claim.
- Credentials stay server-side and out of git, video, logs and screenshots. Do not paste keys into the video brief.

## Repository and team map

- PR #6: teammate UI — hero, rocket illustration, agent solar system and results components.
- PR #3: teammate readiness/discovery checks and portable Orbit Lab.
- PR #5: owner backend/spatial/STL foundation and handoffs.
- Local branch `integrate/sift-live-workspace`: combined work and new integration verification, not yet published as a completed merge.
- This PR: video brief only. It does not replace or merge any of the above.

Design references: [Anatomy](https://github.com/wheresryan22/anatomy) for precise machine annotations and [Etch](https://github.com/PranavAchar01/etch) for direct interaction with the object being worked on. They are inspiration, not evidence that Sift includes all their features. Earlier research links included [3D web scene performance skill](https://github.com/hiddentao/3d-web-scene-performance-skill) and [Artificial General Research](https://github.com/JoaquinMulet/Artificial-General-Research); do not claim unverified code reuse.

**Before recording:** confirm the correct working server, active provider setup, a fresh source project, readable run identity, actual accepted receipt and visible selection/dispatch. The goal is a clear, honest minute showing one complete engineering loop.
