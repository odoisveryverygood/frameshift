# Sift — three-minute live demo

One main speaker. The second teammate operates the screen and watches the clock. Target roughly 125–140 spoken words per minute, leaving room for clicks. Start the optimization within the first 25 seconds.

## Spoken script and screen cues

**0:00–0:20 — Main speaker**  
[Show the original 2,000-robot simulator.]

“This is Sift, an AI performance engineer for 3D applications. Developers can get a simulation working and still spend hours finding why it wastes rendering time. Sift investigates the source, makes a change, and checks the result against the original application.”

**0:20–0:40 — Main speaker**  
[Operator clicks Improve performance in the untouched project.]

“Here we have two thousand moving warehouse robots. I’m asking Sift to reduce rendering overhead while preserving their appearance, motion, and individual selection. This starts a real source-code experiment. The simulator is our authored test application, and the profiling foundation predates the event.”

**0:40–1:10 — Main speaker**  
[Keep real run activity visible; open a source-backed finding if available.]

“The Investigator reads measured performance and follows the project’s source files. Here, the initial renderer creates separate meshes and materials for every robot. That produces thousands of draw submissions. The investigation passes its source-backed findings to the Optimizer, which uses Meta to make a focused patch in an isolated copy.”

**1:10–1:40 — Main speaker**  
[Show the actual patch or candidate-ready state when it exists.]

“The original project stays untouched. If the candidate fails to build or run, the coding agent can attempt a targeted repair. Subquadratic examines regression risks and selects additional protected checks. Fetch carries revision-checked handoffs between the stages. The candidate becomes available for inspection before testing finishes, with its status clearly shown.”

**1:40–2:10 — Main speaker**  
[Open the actual completed verdict and Measurements. If still running, use the fallback below.]

“The acceptance decision comes from deterministic tests, rather than the model’s own assessment. They compare rendered views, robot transforms, identities, and picking at fixed simulation times. In our completed validation, draw calls fell from six thousand and nine to twelve. CPU submission p95 fell from eighteen point three to one point five milliseconds. Frame rate stayed around sixty.”

**2:10–2:35 — Main speaker**  
[Switch Original/Current. In the optimized application, locate robot 1188, select it, and dispatch it.]

“Let’s inspect the result. The robots still move, and this individual robot can still be selected and assigned a delivery after batching. The configured verifier passed sixteen checkpoints. We also exercised selection and dispatch directly in the optimized build. Those checks establish the tested behavior; they don’t prove every possible interaction.”

**2:35–3:00 — Main speaker**  
[Show the accepted patch and Export cumulative patch. Do not apply it during the pitch.]

“The output is a runnable candidate, an inspectable source patch, and verification evidence tied to the tested source. The developer can review and export the improvement before applying it. That is our Trust but Verify workflow: use agents to investigate and change real software, then require measured results and executed checks before keeping the change.”

## Operator runbook

| Time | Action | Expected result | Evidence / fallback |
|---|---|---|---|
| Before start | Open the fresh original project at http://127.0.0.1:4310/?project=3fec7394-adf | Original 2,000-robot fleet, baseline ready, no accepted patch | This ID is local to the author's machine. On a teammate's computer connect the extracted simulator folder to generate its own ID. |
| By 0:25 | Click Improve performance with the prepared preservation goal | A new job and real source-agent activity | Do not launch a second job if the first is slow. |
| 0:40–1:40 | Show actual activity / patch as available | Investigation, implementation, candidate readiness, verification | A pending candidate is Testing, not Verified. Don't fill missing states with animation. |
| 1:40–2:10 | Open Measurements and verdict | Current run's measured values and actual acceptance | Say the current numbers if they differ from the prior validated result. Never promise the exact same result. |
| 2:10–2:35 | Compare; locate robot 1188; select and dispatch | Correct robot ID and queued assignment in optimized app | Show assignment queued; don't wait for its full route during the pitch. |
| 2:35–3:00 | Show/export patch | Actual source diff | Source remains unchanged until Apply. |

The last successful optimization ran from 15:13:17 to 15:14:46 PT, approximately **89 seconds**, on November 7, 2026. This was an actual execution, not a full speaker rehearsal. The live three-minute presentation still needs one timed rehearsal. Provider and machine timing can vary.

## Clearly labelled fallback

If the live run is still working at 1:40, say:

> “The live run is still testing. I’ll leave its status visible and show a separate completed validation so we can inspect the full result within our three minutes.”

Open the completed validation project in the second tab: http://127.0.0.1:4310/?project=e661cf7a-bb5. Explicitly identify it as the previous run. The new run can continue. If a live call fails, show the error honestly and use the same labelled prior result; do not claim the failed request succeeded.

This fallback has a real accepted candidate and verification evidence, not fabricated metrics. Local validation run: `968d6ff0-f7f`, experiment `4f72adf0-99a`. Its receipt and measured-evidence hashes were checked while preparing this script. New computers must generate or transfer their own authorized runtime artifacts; the ZIP does not recreate these local IDs.

## Short judge answers

**What makes it agentic?**  
The source agents choose inspection tools, follow dependencies, produce targeted patches, and receive concrete repair feedback. A separate execution/verification system controls whether a candidate is retained.

**Can the optimizing model mark itself passed?**  
Its tool allowlist cannot edit the protected harness or acceptance policy. The verifier reads measured artifacts and produces a receipt tied to source and policy hashes. This is a controlled local workflow, not a proof against arbitrary hostile code.

**Which sponsor does what in this demonstrated run?**  
Meta powers the Investigator and Optimizer. SubQ plans additional protected checks; deterministic code executes them. Fetch uAgents carry typed revision-bound handoffs. A separate registered Sift entry agent was also tested end to end through ASI:One on the warehouse workflow. Gemini visual investigation and STL advice exist separately; this recorded simulator run used Meta for investigation. Do not claim every provider runs on every task.

**Are four separate AI agents all running here?**  
No. The performance run has an Investigator, Optimizer, SubQ risk planning and deterministic verification. Coding repair attempts occur inside the Optimizer when needed. The separate STL Repair agent is not part of this simulator run.

**Does it repair a robot's physical CAD or control real hardware?**  
This demo improves the simulator's rendering code. It does not establish autonomous mechanical CAD assembly repair or physical robot behavior. The simulator uses deterministic kinematic routes.

**What was built during the event?**  
Disclose the earlier profiler and describe your specific event-time contributions using `TEAM-README.md` and the repository's provenance record. Don't present the entire repository as newly written during the hackathon.

## Keep these claims precise

- Say **CPU submission p95**, not average FPS or GPU utilization.
- The prior paired measurement was 18.3 → 1.5 ms; initial baseline was 18.5 ms. Both are recorded, with different measurement scopes.
- FPS remained near 60 in that validation.
- Sixteen configured checkpoints passed; no claim of universal correctness.
- Authored simulator, real model requests, real source edits and real checks. No customer or deployment claims.
- A live job has variable latency; no promise of an 89-second completion every time.
