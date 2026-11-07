# Executable Skill Lab — November 7, 2026

## Checks executed

- `npm test`: 47 tests passed. Includes separate-process execution, transfer on
  different source inputs, source/host-control rejection, bounded timeouts, model
  transport validation, training-only feedback, geometry/hierarchy stress cases,
  and held-out adoption requirements.
- `npm run build`: production build passed.
- `npm run verify`: all 10 existing integration checks passed after worker/API changes.
- `node scripts/verify-skill-lab.mjs --run 4c2dd350-6fe`: 13 live/local evidence checks
  passed. This reads an actual completed run, recomputes adoption, verifies the
  current cohort seal and code/context hashes, checks real screenshots/clicks, and
  exercises cross-origin, held-out-training and artifact-path denial.
- Real browser checks: latest adopted run, executable-code inspection, screenshot
  delivery, 390px mobile layout without horizontal overflow, and zero console errors.

## Actual accepted run

Run `4c2dd350-6fe` generated skill `bea7a0e3-0a0`, registry version 6, using the
configured `gpt-5.4` provider. No new API key or account was required. The skill is
an executable source transformer, not a saved patch or a hardcoded fixture lookup.

| Application/check | Original draw calls | Candidate draw calls |
|---|---:|---:|
| Training cells | 196 | 2 |
| Training geometry variation | 196 | 6 |
| Training moving-parent variation | 196 | 2 |
| Held-out assembly | 120 | 12 |
| Held-out warehouse | 240 | 15 |

On the held-out assembly, paired CPU submission p95 changed from approximately
1.6 to 0.9 ms; warehouse from 2.7 to 1.2 ms. Frame interval p95 stayed approximately
16.8 ms in both. Aggregate held-out draw calls decreased from 360 to 27 (92.5%).
These are local headless Chrome measurements on one Mac, not a universal speedup
or an FPS multiplier.

Each application received eight capture checkpoints, semantic transform/object
checks, picking probes, and a real click selected from the reference app. The
visible selection output matched the expected original identity. Training and its
stress cases passed before the skill was frozen for the two evaluation applications.
No model call occurs inside held-out evaluation. The registry adopted the skill
only after both projects and the incumbent comparison passed.

## Failures preserved

This was not a perfect first attempt. Actual earlier candidates failed output
validation, duplicated semantic objects, raised a runtime error, or failed transfer.
For example, run `e346bc48-5d3` passed base training and the warehouse but failed the
assembly. It did not adopt a skill. `verification/skill-lab-rejection.json` records
that outcome; it is not a deliberately seeded failure. Training failures were
available to subsequent generations; held-out source and failure details were not.

During development the authors added training-derived geometry and hierarchy
stress cases and inspected evaluation results. The evaluation apps stayed fixed.
This is a suite withheld from the generator, not a blind independent study or
proof against adaptive overfitting. The documentation and UI disclose suite reuse.

## Evidence files

- `verification/skill-lab-live.json`: actual summaries, guards, decisions and checks.
- `verification/skill-lab-cohort.json`: original fixture/policy/implementation seal.
- `verification/skill-generation-context.json`: recorded training context; source
  and feedback can be inspected rather than trusting an assertion about isolation.
- `verification/learned-instancing-skill.json`: actual adopted generated code.
- `verification/rejected-instancing-skill.json`: actual failed-transfer generated code.
- `verification/skill-lab-desktop.png`, `verification/skill-lab-mobile.png`: real UI.

Generated-code JSON artifacts are historical evidence. They are not silently loaded
as active skills on a fresh checkout, and their recorded metrics are not presented
as a fresh benchmark. A new checkout needs configured model access to discover a
new skill. The local adopted registry and full run workspaces remain ignored.

## Scope

The executable family targets factory modules exporting `createWorld(THREE, scene)`
with `update(t)`, repeated opaque meshes, and stable semantic identities. Three
authored application sources differ in geometry, material/layout and nested motion
but share that contract. It is not arbitrary-application support. Passing checks
covers sampled states, not all behavior. CPU submission is not GPU utilization.
Meta and Subquadratic were not configured or tested live in this change. No sponsor
integration or award eligibility is implied by the existing model provider.

Main frontend files, project-doctor/CLI ownership and teammate example work were
left unchanged. Work is published as a feature PR; `main` is not directly updated.
