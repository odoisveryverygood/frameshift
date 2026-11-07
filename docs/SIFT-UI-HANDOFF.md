# Sift — UI teammate handoff

Updated November 7, 2026. This is the current implementation handoff. Older Earl/FrameShift plans and screenshots are historical. **The UI teammate owns the Sift name, logo, color scheme, layout, motion, and agent visualization.** Those visual changes have not been implemented in this handoff.

## Get the complete code

Start from this branch, not the older main branch:

```sh
git fetch origin
git switch -c feat/sift-ui origin/feat/stl-repair-import
npm ci
npm run build
npm start
```

Open http://127.0.0.1:4310. Node 22+ and Chrome are required. `npm run dev` enables frontend development. The server and job worker are separate. **Push only your feature branch and open a PR; never push directly to main.** Until this handoff PR merges, base dependent UI work on `feat/stl-repair-import`; coordinate overlapping server edits with the owner.

This contains the actual backend, spatial bridge, AI tools, verification, large-file import, repair UI and tests. A new checkout does not contain another machine's API keys, robot CAD, generated candidates, historical run IDs, Python virtualenv, or installed packages. They are local runtime data, not missing application code.

### Fast reproducible UI check

With the server running, use a second terminal:

```sh
npm run demo:repair
```

This uploads `tests/fixtures/stl/two-part-alignment.stl`, calculates its known alignment, exports a real candidate, checks the independent result, and prints a working `/repair?import=...&candidate=...` link. No model call or model key is needed. It is an **authored two-part fixture**, useful for animation and regression checks. It is not evidence of a robot mounting position. The actual robot is separately supported and must be imported through Robot STL.

For the real file: Connect → Robot STL → select export units → Inspect and repair → Open repair workspace. The tested large-file path accepts binary STL up to 768 MiB / 15 million facets. Normalization, overview and exported geometry operate on the complete file. The displayed overview is an approximation, not every triangle.

## Four visual agent roles: map them to actual work

| Product role | Existing implementation | Evidence the UI can show |
|---|---|---|
| Investigator | `server/spatial.mjs`, `server/gemini-investigator.mjs`, `server/investigator.mjs` | Selected semantic ID, backend scene capture, inspected source, qualified finding, uncertainty and tool trace. Argon is the configured visual investigator; Meta investigation also exists. |
| Optimizer | `server/agent.mjs`, `server/runner.mjs`, `server/model.mjs` | Meta source-tool calls, exact patch, isolated build, repair attempts, runnable candidate readiness. |
| Repair | `server/stl/repair-agent.mjs`, `repairs.mjs`, `repair-geometry.mjs` | Live Gemini tools: read actual mesh report, measure a region, solve confirmed mounting correspondences, or propose measured axial gap closure. Bounded geometry worker writes the full STL. |
| Verifier | `server/subq.mjs`, `server/verifier.mjs`, `server/benchmark.mjs`, `server/stl/repair-geometry.mjs` | SubQ adds protected performance checks; deterministic code executes checks and decides. STL has a separate independent whole-file transform verification pass. |

**These four roles exist across two workflows. There is no implemented single run in which all four LLM roles execute concurrently.** Performance jobs use investigation → optimization → risk planning and verification. STL jobs use Repair tools → geometry execution → independent verification; Meta and SubQ are not called by that STL path. Show unused roles as idle or not involved. The deterministic verifier is not another LLM.

Fetch carries real local typed performance handoffs (`InvestigationReady`, `PatchReady`, `VerificationResult`). Public Agentverse discovery/remote messaging is unverified. ASI connectivity was tested separately; ASI is not the active repair engine. Do not label a local handoff as a remote agent call.

## Where to change the interface

| File | Responsibility |
|---|---|
| `src/main.jsx`, `src/style.css` | Main project/scene workspace, connection modal, findings, experiments, evidence drawers, routing to repair. |
| `src/RobotRepair.jsx`, `src/robot-repair.css` | Standalone full-viewport repair UI; region, landmarks, proposed candidate, exported candidate loading and shared camera. |
| `src/StlImport.jsx` | Real file upload/progress, units, normalization review and opening the repair workspace. |
| `src/SpatialWorkspace.jsx` | Selection pins, investigation ribbon, experiment timeline, challenge markers and evidence. |
| `sdk/spatial.mjs` | Scene selection, camera/time context and validated parent/frame messages. Preserve the boundary checks. |
| `server/stl/viewer-template.mjs` | Generated imported-STL performance viewer. This is separate from the new repair page. |
| `index.html`, `README.md` | Browser title and public product text. Runtime still contains Earl branding. |

Keep the current `EARL_*` environment names, SDK message names, stored IDs, `__frameshift` adapter and endpoint paths compatible during the visual rebrand. Changing them is a protocol migration, not a logo edit. Keep the entry route `/repair` and saved candidate URLs working.

## Live scene changes and animations

Use one dominant viewport, a contextual input, a compact agent strip, and evidence on demand. Motion should make a real state change visible: selecting a region, receiving a finding, building a candidate, moving the selected geometry, or displaying executed checks.

- Before export, the repair Candidate is a **local proposal preview** using the solver's column-major 16-number matrix. Do not apply it to unrelated geometry.
- After export succeeds, fetch `candidate.previewPositionsUrl`. The backend derives that geometry by reading the actual exported STL. Automatically switch to it; **do not apply the plan matrix again**. Source and candidate vertex counts can differ.
- Original/Candidate share a camera and controls. Swapping geometry must not reset the camera. Rebuild/refit BVH data when positions change; clean up GPU resources on unmount.
- Keep statuses distinct: Proposed → Exporting/checking → Exported candidate loaded. A geometric gap-closure proposal is not confirmed mounting alignment.
- Performance candidates become playable only when `previewReady` and `previewUrl` exist. `previewStatus: "testing"` means checks are incomplete. Acceptance comes from the persisted verdict.
- Rendering overlays and animation explainers must pause during timed performance measurements. CPU submission timing is not GPU utilization or proof of an FPS gain.

**Progress availability:** `GET /api/events` is SSE with `data: update` refresh notifications, not structured tool tokens. Refetch `/api/state`; use `run.phase`, `run.events`, experiment traces, `previewReady`, and persisted verdicts. Spatial finding requests expose `project.spatialActivity`. Repair API requests currently return their completed tool traces; there is no repair per-tool SSE stream. During a pending request show a loading phase; display the returned trace as completed work. A future four-role live event stream/coordinator needs backend implementation and verification. Do not synthesize a history or make all cards look busy on a timer.

## Repair API contracts

Prefix: `/api/stl/imports/:importId`. IDs are created by the backend; do not hardcode IDs from the owner's computer.

| Endpoint | Request / returned state |
|---|---|
| `POST /api/stl/import?filename=...&units=mm` | `application/octet-stream` file body. Returns `{import}` with ID, truthful report and preserved-original download. Use XHR upload progress; full-file scanning has no fabricated percentage. |
| `GET /repair-data` | `{positionsUrl, metadata, regionSuggestions, provider}`. Float32 xyz triangle geometry, raw export units, measured full bounds, overview limitations. Suggested groups are verified geometric regions, not named parts. |
| `POST /repair-plan` | `{bounds:{min:[x,y,z],max:[x,y,z]},sourcePoints:[[x,y,z],...],targetPoints:[[x,y,z],...]}` → `{plan}`. At least 3 non-collinear pairs; max error must meet the unit-aware tolerance; no scaling/mirroring. |
| `POST /repair-gap-plan` | `{bounds}` matching a measured separated group → `{plan}` with `kind:"gap-closure-proposal"`, matrix, axis, gap, translation and unconfirmed intent. `rmsError`/`maxError` are null because no mounting correspondences were supplied. |
| `POST /repair-agent` | `{goal,bounds,sourcePoints,targetPoints}` → actual provider/model, `message`, `trace`, optional `plan`, and `status:"needs_input"` or `"plan_ready"`. A plan is a proposal, not export approval. |
| `POST /repair-candidates` | `{planId,confirmPlacement:true}` → `{candidate}` after export, independent checks and backend-derived overview. Only verified candidates have usable download/preview links. |
| `GET /repair-candidates/:candidateId` | `{candidate,plan}`. Used by `/repair?import=ID&candidate=CID` to reload the real exported candidate. |
| `GET /repair-candidates/:candidateId/preview.bin` | Actual exported candidate overview as Float32 xyz. Scope remains approximate. |
| `GET /repair-candidates/:candidateId/download` | Complete binary STL, including every retained facet. |

`candidate.verification` contains full-file counts, source/output hashes, selected/unselected hashes, actual bounds and individual checks. A verified transform preserves the original header, attributes, face count and exact outside-region bytes, and checks transformed positions/normals. A region cutting through geometry is rejected. Source-bound plans cannot be silently altered. Gap closure checks axial bounds touching; it does not establish fastener fit, collisions, strength, or manufacturing readiness.

## Scene/performance contracts

Use `/api/state`, `/api/projects/:id/findings`, `/api/projects/:id/runs`, `/api/projects/:id/challenges`, and returned candidate preview URLs. See [spatial contracts](SPATIAL-WORKSPACE.md) and [agent pipeline](AGENT-PIPELINE.md) for complete details.

The frame bridge uses existing `frameshift:context`, `frameshift:selection`, `frameshift:sync`, `frameshift:step`, `frameshift:record-start`, `frameshift:record-stop`, `frameshift:interaction` and telemetry messages. Validate event source/origin, preserve actual object identities, and show whole-frame counters with their scope. Code/source mapping remains inferred where labeled. A Three.js InstancedMesh instance is not automatically a named CAD part.

## Configuration and proof

Backend credentials go in ignored `.env.local`; variable names and provider configuration are in `.env.example`. Gemini enables the Repair agent and visual investigator. Meta/SubQ and the pinned Fetch Python environment enable the sponsor performance pipeline. Math, file inspection, alignment and deterministic repair export do not need a model key. An unavailable provider must show a useful error, not fake an AI result. Transfer credentials privately; never embed them in frontend code, fixtures, screenshots, PRs, public env files or browser payloads.

Latest local verification before this handoff: **99 Node tests passed**, production build passed, real UI picking/point entry/export passed, and saved backend candidate loading passed. The actual 640 MB robot was scanned; a full-file proposed translation preserved 11,382,741 outside-region triangles unchanged. Its physical mounting remains unconfirmed. Private CAD and local receipts are excluded; fresh checkouts must generate their own evidence.

```sh
npm test
npm run build
npm run demo:repair
```

Test empty/error/loading states, boundary-cut rejection, invalid/collinear landmarks, failed provider calls, proposal review, export failure, actual candidate reload, Original/Candidate switching, resize, and a narrow screen. Deterministic geometry verification cannot be replaced with an animation or model confidence.

Design references: [Anatomy](https://github.com/wheresryan22/anatomy) for precise annotations and restrained motion; [Etch](https://github.com/PranavAchar01/etch) for direct selection and contextual questions. These are inspiration references, not claims that their source was copied. Actual new geometry dependencies are `ml-matrix` and `three-mesh-bvh`; a downloaded parts catalog and automatic vendor-part matching are not implemented.
