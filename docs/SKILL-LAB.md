# Earl executable Skill Lab

Open `http://127.0.0.1:4310/lab/` after `npm run dev` or `npm start`.
The lab uses the configured model provider. It does not require a new account if
your current provider already works. Meta and Subquadratic are not automatically
provisioned or claimed as verified integrations.

## What is new

The agent now proposes executable JavaScript source transformations, rather than
only project-specific patches. Each generated `transform(files)` reads allowed
source text and returns edited files. It is run without model access against
other applications after training passes. An adopted version becomes the incumbent
for future discovery runs; new candidates must improve on it, not merely beat the
original unoptimized applications.

The initial supported family is conservative instancing of repeated opaque meshes
inside `createWorld(THREE, scene)` modules exposing `update(t)`. This is a bounded
family with an explicit source contract, not a general optimizer/compiler for
arbitrary Three.js code. The main project workspace remains available at `/`.
The lab does not silently apply a learned skill to connected user projects.

## Learning and evaluation

1. The generator receives the learning project's allowed source, previous skill
   code, and training failures. It receives no held-out source or held-out feedback.
2. A separate restricted process executes the transformer with only source strings.
   Host process/filesystem APIs and dynamic code generation are not exposed in its
   VM. Output paths, sizes, source hashes and protected controls are validated.
3. The training application and geometry/hierarchy stress cases derived from it
   are built, captured, clicked and measured. The stress-case source is training
   context; it is not evaluation source. Failed
   transformations become saved candidate versions and training feedback.
4. A training pass freezes the skill. The evaluator applies those same bytes to
   a nested cylinder assembly and independently moving warehouse carts without
   making another model call.
5. Each project receives eight capture checkpoints, semantic transform and picking
   checks, a real reference-selected click with visible output assertions, and
   alternating reference/candidate benchmarks. A visually identical image alone
   cannot establish behavior preservation.
6. Adoption requires both held-out projects to pass, valid repeated measurements,
   no individual rendering/CPU/frame-pacing regression under the configured guards,
   and aggregate draw-call improvement beyond the fixed 8% threshold over the
   incumbent. An error, no-op, failure or inconclusive result cannot promote a skill.
7. The active registry changes only after that gate. Failed candidates remain in
   history and the previous active version is retained. After the held-out gate,
   the run ends; those failures are not fed into a repair prompt.

These are authored fixtures excluded from the generator, not independently
collected customer projects. All share the documented factory interface but differ
in geometry, materials, hierarchy and animation. Humans can inspect their source.
The fixed suite was inspected by the authors during development and is reused
across runs; it is held out from the generator, not a blind independent study.
This is not an unlimited supply of fresh
hidden tests or proof of universal generalization. Skills update code, not weights.

## Provenance and recovery

Local records are in ignored `.frameshift/skill-lab/`: generated skills, source
hashes, version parents, training memory, original/candidate builds, screenshots,
guards, raw measurements, cohort/implementation hashes, and adoption decisions.
Generation contexts are recorded by the current worker implementation. Context
records added after an earlier run must not be described as that run's payload log.
No API key is stored in a skill or returned to the browser.

The normal job worker serializes lab runs and ordinary project jobs, keeping
benchmarks from running concurrently. Stop requests abort model/build/browser work.
An interrupted uncommitted lab run fails safely with its evidence preserved;
it is not automatically resumed across model/evaluation boundaries. A committed
registry update is reconciled on restart. Restart workers after source-code edits
so the loaded implementation matches the code being fingerprinted.

The macOS build sandbox restricts filesystem access and networking. The VM adds
another restriction, but neither is presented as an audited hostile-code sandbox.
On platforms without the OS restrictions, only the documented process/VM controls
are available. Use authorized projects and source.

## Check the feature

```sh
npm test
npm run build
# Inspect a real completed adopted run, without starting a model request:
node scripts/verify-skill-lab.mjs --run YOUR_RUN_ID
```

The script fails if the run was rejected, incomplete, or missing real evidence.
It recomputes adoption, checks executable hashes, screenshots, click assertions,
and protected API paths. It writes `verification/skill-lab-live.json` only after
the checks pass. Unit tests use explicitly local/mocked transport cases; those
are distinct from a live model/browser run.

## Team integration

Teammate 2 can link `/lab/` from the redesigned main workspace and reuse the
read-only `/api/lab` state. Owner changes are confined to the new lab, skill
engine, worker integration and API routes; main `src/` files are untouched.
Teammate 3's `examples/orbit-lab`, project doctor and CLI work remain separate.

Push feature branches and open PRs targeting `main`; do not push directly to
`main` or merge without owner review. Preserve all prior-work and license credits.
