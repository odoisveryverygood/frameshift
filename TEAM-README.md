# Sift — complete team project guide

Updated November 7, 2026. Read this for the product, agent roles, sponsor integrations, hackathon fit, evidence and demo story. Read the [UI handoff](docs/SIFT-UI-HANDOFF.md) for component ownership, endpoints and animation contracts. Earl and FrameShift are previous names; much of the runtime still uses those identifiers.

## 1. What Sift is

Sift is a local 3D engineering workspace where an AI can investigate a real application or mesh, propose a change, execute it on a copy, and produce evidence about what changed and what stayed intact. The running 3D scene is where users select a problem, inspect a candidate, compare it with the original and review the result.

The original problem was slow Three.js applications: developers manually profile rendering, locate expensive source code, make optimizations, and check that objects, appearance and interactions still work. FrameShift/Earl automated that loop. The project then added an in-scene investigation layer and a separate STL repair/alignment workflow for an FTC robot.

The common idea is **give AI tools to make a real change, then make independent executed checks control acceptance**. The scene is the workspace and evidence, rather than a metrics dashboard being the main product.

### What currently works

| Workflow | What a user gets | What this does not establish |
|---|---|---|
| Three.js performance | Connect a trusted Vite + Three.js WebGL project, profile it, inspect selected objects/source, create an isolated patch, build it, execute checks, measure it, review/apply an accepted improvement. | Support for every framework, arbitrary interaction correctness, universal speedups, or GPU utilization from CPU timing. |
| STL repair/alignment | Upload ASCII/small binary or large binary STL, retain the original, normalize reported mesh defects, select a complete region, calculate a rigid alignment or review a measured-gap proposal, export the complete file, and load the exported candidate's overview. | Native parametric CAD, inferred assembly constraints, automatic reconstruction of missing parts, arbitrary hole repair, mounting suitability, collision clearance or structural/printability certification. |
| Executable Skill Lab | Generate a reusable source transformer, test training cases, freeze it, evaluate it on two authored held-out applications, and adopt or reject its version. | Model-weight training, universal self-improvement, independently collected customer projects, or a blind study. |

The actual robot workflow is not limited to the small demo fixture: a 640 MB binary STL with 12,808,642 input facets was processed locally. The fixture exists so another teammate can quickly test UI behavior and actual file export without receiving private robot CAD or making model calls.

## 2. The four product roles

| Role | Actual work and tools | Provider / authority |
|---|---|---|
| **Investigator** | Inspect the selected scene, a backend screenshot, measurements, source/dependencies and past findings; produce a qualified, source-backed hypothesis. | Gemini 4 Argon is the visual provider. Separate Meta investigation also exists. Object IDs and measurements come from instrumentation, not image guesses. |
| **Optimizer** | Inspect allowed files, submit targeted edits in an isolated copy, receive actual build/check failures, and attempt bounded repairs. | Meta Model API, currently `muse-spark-1.3` in the tested setup. It cannot approve its own patch. |
| **Repair** | Read the actual mesh report, measure a full-resolution selected region, request a rigid alignment from supplied landmarks or propose closing a measured axial gap. | Live Gemini 4 Argon chooses bounded tools. Local geometry code performs the mathematics and writes the complete STL. |
| **Verifier** | Assess risks, execute protected checks, compare artifacts/behavior and decide whether a result meets its stated standard. | SubQ plans additional performance checks; deterministic code executes them and decides. STL uses an independent full-file geometry verification pass. |

**The four roles are not all running concurrently in one implemented chain.** Performance uses Investigator → Optimizer → risk planning/verification. STL uses Repair tools → geometry execution → independent verification. Meta and SubQ are not called by the current STL repair path. The UI can present four roles, with truthful active, waiting, completed, failed and unused states.

The specialist conversations and permissions are separate. “Multi-agent” here means distinct roles, tools, contexts and checked handoffs; it does not mean every role needs a different model family. The final verifier is code, not another model's confidence score.

## 3. How the workflows operate

### Performance and scene investigation

1. Discover a trusted local project: framework, entry modules, Three.js version, dependencies and build configuration.
2. Build a copy and collect baseline rendering counters, CPU submission/frame-pacing measurements, screenshots and observed state.
3. Select a real semantic object or instance in the viewport. Its camera, time, identity and source revision become investigation context.
4. The Investigator reads actual source and measurements, qualifies uncertain source associations and proposes an experiment.
5. A revision-checked local Fetch handoff carries the investigation to the Optimizer. Meta creates a focused source patch in an isolated candidate.
6. SubQ assesses identity, animation, geometry and timing risks. Scores crossing the fixed threshold add protected checkpoints; low scores cannot remove baseline checks or loosen tolerances.
7. Once the build succeeds, its actual runnable preview becomes available as **Testing**. The verifier checks sampled appearance, transforms, picking and relevant observed behavior. Paired alternating measurements assess improvement and variability.
8. The deterministic decision accepts, rejects or marks the result inconclusive. Failed candidates are not promoted. Users can inspect evidence/patches, challenge an interaction and apply an accepted change.

The original/candidate scene bridge shares camera and controlled simulation time where instrumentation supports it. Diagnostic overlays are paused during timed measurements. Recorded selection challenges execute against both versions; arbitrary natural-language behavior claims require an observable test.

### Robot STL repair/alignment

1. Upload the file and explicitly choose its export units. STL does not reliably encode units, joints or part names.
2. Preserve the received bytes and fingerprint. Small imports can assess more topology; the bounded large-binary path scans every facet, removes reported non-finite/zero-area facets and recomputes normals. Its global topology/duplicate/winding analysis is limited and labeled.
3. Derive a surface overview from the complete source, under a display budget. It can omit small features or introduce display gaps; the full STL remains separate.
4. Suggest geometrically separated regions when empty-space evidence survives a full-resolution scan. The user confirms which region is the intended moving part. A selection cutting through triangles is rejected.
5. Either supply at least three non-collinear matching mounting points for a rigid fit, or preview an explicitly unconfirmed axial gap-closure proposal. Scaling and mirroring are prohibited. A gap proposal does not invent mounting correspondences.
6. Review the candidate. A model cannot approve export. A placement confirmation authorizes writing a separate candidate file.
7. The worker writes the complete binary STL. A separate pass checks facet counts, finite positions, rigidly transformed positions/normals, preserved header/attributes and exact unchanged bytes outside the selected region. Gap proposals also check the resulting axial interval separation.
8. Re-read the exported candidate, derive its own overview, and load that backend geometry into Candidate automatically. Original/Candidate share the camera. The preview is not merely an animation pretending to be a saved file.

The actual file produced two measurable separated groups with a 48 mm Z gap. A tested proposal translated the upper group down 48 mm, transforming 1,425,872 facets and preserving the other 11,382,741 facets unchanged. Independent execution checks passed. **This is a geometric placement proposal; physical mounting intent and fit remain unconfirmed.** Private CAD and its candidate are not in the public repository.

### Skill Lab and learning

The agent proposes executable source-transformer code rather than only one project's patch. Training failures can inform a new version. A passing version is frozen before a separate evaluator applies the same bytes, without another model call, to two different applications. Adoption requires correctness and measured improvement against the incumbent. Rejected versions remain in history; the incumbent is retained.

The held-out source and evaluation feedback are excluded from the generator's repair loop. The fixtures are authored, fixed and known to the team, so describe this as held out **from the generator**, not an independent blind evaluation. This is a bounded instancing skill family, not an unrestricted autonomous software scientist. [Skill Lab details](docs/SKILL-LAB.md).

## 4. Exactly how each sponsor is used

Problem statements, sponsor integrations and prize categories are different things. Using an API does not automatically establish sponsor-prize eligibility.

| Sponsor / service | Actual integration | Why it is useful | Status and limits |
|---|---|---|---|
| **Google / Gemini** | `gemini-4-argon` inspects a backend scene screenshot plus source tools for visual investigation. A separate Repair conversation reads mesh facts and invokes measurement/alignment/gap-proposal tools. | Connects visual/spatial context with grounded investigation and executable geometry operations. | Live calls and tool traces verified. Repair currently receives goal/report/region/landmarks, not the entire raw CAD or a vision stream. Uses bounded `generateContent` function calls; not Antigravity Managed Agents or a migrated Interactions API implementation. |
| **Meta Model API** | Separate investigation/optimization contexts inspect source, create targeted patches and repair failures in candidates. The tested model is `muse-spark-1.3`. | Performs actual engineering edits and responds to executed failure evidence. | Live accepted warehouse optimization recorded. Not the STL geometry writer. Sponsor mode fails explicitly if required provider access is missing. |
| **Subquadratic** | `subq-snap-1.1` supplies structured risk decisions for identity, animation, geometry and timing. The host maps those decisions to additional protected checkpoints. | Its output changes which checks actually execute, rather than adding decorative commentary. | Live risk-selected checks were executed. It cannot weaken baseline policy or declare acceptance. Not used by the current STL workflow. |
| **Fetch.ai uAgents** | Three stable local identities exchange typed investigation/patch/verification handoffs. Job, attempt and revision/artifact hashes are checked. | Gives real specialist delivery/ordering boundaries and rejects stale, duplicate or mismatched handoffs. | Real local SDK dispatch verified. Public registration, ACP and ASI:One primary-workflow delivery remain unfinished. Local dispatch alone is insufficient for the Fetch prize requirements below. |
| **ASI:One** | Account/key setup and a separate bounded `asi1-mini` connectivity call were verified. | Potential future conversational access to an independently callable verifier. | Connectivity proof only. ASI is not powering the main optimization/repair engine or hosting its current user workflow. |
| **Agentverse** | Account sign-in was completed. | Intended public discovery/transport layer. | No registered public agent or verified discovery/remote delivery is claimed. |
| **MongoDB** | No current integration. Local jobs, files, evidence and versions are persisted on disk. | A future hosted system might use a database, but it is not required to explain the current build. | Do not claim MongoDB use merely because credits were offered. |
| **OpenAI** | Earlier/configured-provider performance mode and compatibility tests remain available. | Optional existing provider route. | Not a sponsor category listed in the supplied guide and not silently substituted for missing sponsor access. |

Google's supplied [builder guide](https://docs.google.com/document/d/1kN0n6hPNNTIHMVqf5-hDACrZuIg4KFrWiYpla4WQW8w/edit) recommends tool execution, concrete verification signals and appropriate model roles. Sift uses those patterns. It does not claim to use the guide's voice, media-generation, Flash subagents, Deep Research or managed sandbox products merely because they appear there.

### Fetch prize requirements: an explicit gap

The [Fetch-specific challenge guide](https://docs.google.com/document/d/1z7ybvx9I80KI-n4DEieN9i11Zoj4ki4TTvtUWqnULQQ/edit) requires Agentverse registration, Agent Chat Protocol support, ASI:One discovery/direct use, meaningful execution, a complete primary workflow inside ASI:One, and a public runnable repository. It also requires submission through its ASI:One submission agent after the general submission.

Sift has meaningful local orchestration and a public runnable repository. The Agentverse/ACP/ASI:One workflow requirements are not implemented and verified. **Do not present Sift as currently meeting the Fetch prize requirements.** A custom frontend alone cannot satisfy that sponsor's conversational workflow requirement. Adding payments/cards is optional and would not replace the mandatory pieces.

## 5. How the project fits the hackathon problem statements

This mapping uses the participant guide supplied by the team on November 7, 2026. The official event is [AIE Code Summit 2026](https://cerebralvalley.ai/e/aie-code-2026-hackathon). Organizer-specific eligibility and any updates must be confirmed by the team; this document is not an eligibility ruling.

| Problem statement | Our fit | Evidence to show | Boundary |
|---|---|---|---|
| **Trust but Verify** | Strongest direct fit: independent verification controls acceptance of AI-generated code changes; geometry actions also receive separate executed checks. | An actual patch and candidate, a failure that blocks promotion, protected verification policy, expanded checks, receipts, unchanged-behavior evidence and measured results. | Do not describe SubQ's model score as the final verdict. General test-code generation and arbitrary correctness proof are not implemented. |
| **The System That Gets Better** | A bounded additional fit through versioned executable Skill Lab tools, training feedback, frozen versions, held-out application checks and incumbent retention. | The learned transformer version, excluded held-out context, real executed checks and adoption/rejection history. | Repeated project patches alone do not establish self-improvement. No model-weight training, universal skill transfer or blind held-out study is claimed. |
| **Software Archaeology** | Partial conceptual overlap: unfamiliar source/runtime investigation and explicitly inferred scene/source associations. | Observed object identities and behavior, actual source inspection and uncertainty labels. | We have not demonstrated binary recovery, legacy reconstruction, cross-language/runtime porting or broad behavioral equivalence. A broken STL is not automatically software archaeology. Do not make this the primary claim. |

Lead with **Trust but Verify**. Use Skill Lab as evidence for a secondary self-improvement story if it can be explained and demonstrated accurately. The supplied guide requires at least one problem statement; it does not establish that every project can or must claim all three.

### Sponsor awards versus problem statements

The guide lists overall placement awards and separate best-use awards for Meta, Subquadratic and Fetch. It includes Google DeepMind and MongoDB credits/resources, but does not list a separate “Best Use of Google” or “Best Use of MongoDB” award. Do not invent one.

The strongest current sponsor technical stories are Meta making real source changes and SubQ causing additional independent tests to run. Gemini also does substantive live tool work and strengthens the overall demo. Fetch has meaningful local integration but the extra mandatory deployment/conversation requirements above remain unmet. These are technical-fit assessments, not promises of selection, eligibility or an award.

## 6. Judging and the demo

The supplied guide weights round one as technical demo 35%, implementation difficulty 30%, impact 20% and creativity 15%. Technical demo plus difficulty total 65%; that is not a single “working” score. Final-round categories have equal weight. The guide calls for a one-minute submission video, an approximately three-minute live demo plus Q&A, a public repository, no more than four team members, and a 5:00 PM PT submission deadline on November 7.

### Suggested explanation

“Sift lets an AI work on a real 3D application while a separate verification system protects what must stay correct. Select a problem in the scene, inspect the agent's evidence, watch a runnable candidate appear, and compare the executed result. The performance path edits actual source; the STL path exports a full modified mesh. The agent proposes changes, while executed checks control acceptance.”

For the strongest Trust but Verify demo, show a real optimization, its patch, a preserved selection interaction, independent evidence and acceptance. Show a failing check blocking a bad result. Use the robot alignment as an additional tangible geometry workflow, with its proposal/fit limitation visible.

For the video, quickly establish the problem, select a real target, show actual tool work, reveal the actual candidate, then show one decisive executed check. Distinguish a saved result from a new live run and label time cuts. Four agent cards moving on timers are not evidence of orchestration. The system's work should visibly change the actual scene or exported artifact.

The original/candidate switch, actual selected-object identity, a failed-candidate repair, added checks from SubQ, and an independent rejection are useful proof points. A long provider list, an animated dashboard or an unverified “fixed” label is not a substitute.

## 7. Verified evidence and its scope

| Evidence | Recorded result | Scope |
|---|---|---|
| Latest local Node suite | 99 passing tests, production build passed. | The configured development machine. Fresh checkouts should run checks; Fetch tests can skip explicitly if its Python environment is absent. |
| Authored 1,600-robot warehouse | Draw calls 1,611 → 13; CPU submission p95 8.0 → 1.7 ms; 16 checkpoints passed in the recorded spatial run. | One local machine and authored workload. FPS stayed near 60; do not claim an FPS increase or universal speedup. [Evidence](verification/spatial-live-summary.json). |
| Recorded interaction | The same robot identity was selected in original and optimized versions. | The recorded interaction and sampled state, not every possible interaction. |
| Real large STL cleanup | 12,808,642 input facets; 29 zero-area facets removed; 43,257 supplied normals corrected; 12,808,613 facets retained. | Large-path global topology and general repair remain unassessed. Original bytes retained privately. |
| Real large-file gap proposal | Upper group translated 48 mm; 1,425,872 facets transformed and 11,382,741 outside facets unchanged; axial bounds now touch. | Independent execution checks passed; mounting suitability remains unconfirmed. Private CAD/artifact not published. |
| Controlled full-size execution test | Four authored external facets moved while every original robot facet remained unchanged. | A deliberately controlled large-file test, not an actual robot repair result. |
| Skill Lab | Recorded adopted executable version with training and two authored generator-held-out application checks. | Bounded common source contract; no universal learning or customer validation. [Evidence](verification/skill-lab-live.json). |

Public sample receipts and screenshots are under `verification/`. Local full runs, raw CAD, candidates, provider state and credentials are under ignored runtime/configuration paths. An old run ID from the owner's computer is not a working resource in a fresh clone.

## 8. Repositories and building blocks: what was actually used

| Resource | How it fits | Status |
|---|---|---|
| [3D Web Scene Performance skill](https://github.com/hiddentao/3d-web-scene-performance-skill) | Performance reference guidance, included engine probe and adapter reference, retained with attribution/license. | Included reference/probe material. The probe is not itself a runtime profiler. |
| [Artificial General Research](https://github.com/JoaquinMulet/Artificial-General-Research) | Experiment history, fresh contexts, metric/guard separation and keep/discard ideas. | Concepts adapted in Sift's own runner; the complete AGR CLI/Docker stack is not embedded. Upstream speedups are not Sift's results. |
| [uAgents](https://github.com/fetchai/uAgents) | Pinned Python SDK and typed local specialist delivery. | Runtime integration. |
| [ml-matrix](https://github.com/mljs/matrix) | SVD-based rigid landmark fitting, without scale/reflection. | Runtime integration. |
| [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) | Accelerated picking/spatial queries in the repair viewport; refit/rebuild as geometry changes. | Runtime integration. |
| [Anatomy](https://github.com/wheresryan22/anatomy) | Precise contextual annotations and restrained motion. | Design inspiration; no copied source/assets claimed. |
| [Etch](https://github.com/PranavAchar01/etch) | Selecting real parts and questioning them in place. | Design inspiration; no copied source/assets claimed. |
| [FreeCAD parts library](https://github.com/FreeCAD/FreeCAD-library) | Possible small curated reference-part catalog. | Researched, not downloaded/integrated. Respect per-author attribution. |
| [NopSCADlib](https://github.com/nophead/NopSCADlib) | Possible parametric mechanical reference parts. | Researched, not integrated; GPL-3.0 library. |
| [Trimesh](https://github.com/mikedh/trimesh) | Evaluated for registration and mesh operations. | Researched, not a current runtime dependency. The shipped alignment/export engine is Node-based. |
| [meshoptimizer](https://github.com/zeux/meshoptimizer) | Evaluated for preview simplification. | Not a current dependency. Current repair overviews use bounded adaptive vertex clustering. |
| ts-morph / fast-check | Proposed stronger syntax tooling and generated cases. | Not installed/claimed as implemented. |
| OpenHands / pg-boss / Podman | Evaluated alternative backend foundations. | Not embedded or current dependencies. |

Three.js renders scenes; React builds the interface; Vite builds applications; Express serves the local API; Playwright runs browser checks and interaction replays; Pixelmatch/PNGJS compare screenshots; Spector.js provides separate WebGL diagnostics; jsdiff produces reviewable patches; Lucide supplies icons. npm dependencies retain their package licenses. [Attribution details](THIRD_PARTY.md).

Morf was an authorized local interaction reference; its CAD/circuit backend is not embedded here. References to Simtra/Foundry and other admired interfaces are design context, not evidence that their backends were reused. Other visual references include Rive, Spline, NASA Eyes and Lusion/Unseen; their source/assets are not claimed as part of Sift.

## 9. Reliability, data and limitations

Model text can be wrong. Sift limits what tools can do and separates proposals from executed proof; it does not guarantee that an LLM never hallucinates. A mathematically correct transformation can still be the wrong intended assembly. A passing sampled test can miss an untested behavior.

The API and credentials stay on the backend. Visual investigation sends bounded scene context/screenshots and relevant source to its configured provider. Meta receives permitted source, goals, profiles and relevant history. SubQ receives bounded patch-risk context. Repair sends mesh facts, selected-region/landmark context and the goal, rather than the full binary robot file. Local Fetch handoffs carry identities and revision/artifact hashes. No API key belongs in frontend bundles, public documentation, screenshots or Git.

This is a local single-user tool for trusted projects. Builds run under the documented macOS restrictions on the tested machine; workspace copies/receipts are not an audited hostile-code or multi-tenant security system. A hosted product would need additional authentication, tenant isolation, quotas and dedicated runners.

There is no unified four-role live coordinator or repair per-tool SSE stream yet. Performance state and events are available; repair traces currently arrive with the completed response. The UI must distinguish live progress, completed history and saved-result replay. Public Agentverse/ASI:One workflow delivery, automatic vendor-part recognition, a full downloaded parts library, arbitrary hole filling and mechanical certification are not implemented.

## 10. Original work, timeline and submission provenance

The supplied event guide requires the demo to identify work created during the hackathon and distinguish earlier projects/contributions. The repository has pre-start commits. Do not claim that the entire application was created after the event began.

| Commit | Recorded local timestamp | What the history records |
|---|---|---|
| `2342461` | Nov 7, 00:52 PT | Existing FrameShift profiling/optimization foundation published before the stated 10:45 AM start. |
| `1722de9`–`26ab8f1` | Nov 7, 09:46–09:52 PT | Earl mission/verification and path/image fixes before that start. |
| `838a5c2` | Nov 7, 11:13 PT | Initial preview/connection improvements committed. |
| `5b92829` | Nov 7, 11:48 PT | Executable Skill Lab and transfer evaluation committed. |
| `08273b0` | Nov 7, 12:25 PT | Sponsor setup/product plan committed. |
| `7dc5fcf` | Nov 7, 14:33 PT | Spatial agents, sponsor pipeline additions, STL repair and UI handoff committed. |

Commit timestamps are evidence about repository history, not a certification of when every line was authored. Review the actual team work timeline, attribute the pre-existing foundation and third-party work, and confirm the entry's eligibility with the organizers. Demonstrate the specific new functionality rather than representing all earlier code as new event work.

The UI teammate owns Sift's final visual rename, color scheme, animations and focused workspace. The core currently uses legacy Earl/FrameShift protocol/environment names; preserve compatibility. All teammates should work on feature branches and PRs. Main is not updated by pushing this handoff branch. [Complete technical handoff](docs/SIFT-UI-HANDOFF.md).

## 11. What every teammate should be able to explain

- What actual input the agent inspected, which tool it called, and what artifact it changed.
- Which observations are measured, which source/part associations are inferred, and what remains unknown.
- Why a model cannot approve its own work and what a failed check prevents.
- How SubQ changes executed verification, how Meta changes source, how Gemini uses tools, and what local Fetch delivery actually proves.
- Why a gap-closure proposal, a sampled overview and a small authored demo are different from a mechanically verified full robot assembly.
- What learning means in Skill Lab, what is held out from the generator, and why this is not model-weight training.
- Which parts of the project existed before the hackathon and what the team added during the event.

Use the [main README](README.md) for setup, [UI handoff](docs/SIFT-UI-HANDOFF.md) for implementation ownership, [repair guide](docs/REPAIR-WORKSPACE.md) for the mesh workflow, [spatial guide](docs/SPATIAL-WORKSPACE.md) for in-scene investigation, [agent pipeline](docs/AGENT-PIPELINE.md) for optimization evidence, [Skill Lab](docs/SKILL-LAB.md) for bounded self-improvement, and [Fetch setup](integrations/fetch/README.md) for local transport. The supplied participant guide and linked sponsor guides are the source for event requirements; account balances, approvals and prize eligibility are not inferred from successful API calls.
