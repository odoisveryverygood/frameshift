# Robot STL import

Connect → Robot STL → choose a file and its actual export units → Inspect and repair → review → open. Model keys are not needed for deterministic mesh inspection.

For files up to 40 MiB and 200,000 facets, Earl validates ASCII or binary STL, removes reported unusable or duplicate facets, recomputes normals, and repairs relative winding only where topology permits. It reports boundary edges and non-manifold edges. Every changed or removed facet category is counted. Connected shells are inferred geometry, not named robot parts or joints.

Large binary files up to 768 MiB / 15 million facets use a disk-backed upload and bounded streaming worker. The full file is scanned; non-finite and zero-area facets are excluded and normals recomputed in the full cleaned STL. Global duplicate removal, shell topology, hole filling, self-intersections, and relative winding are **not assessed by this large-file path**.

A large file opens in [the repair workspace](REPAIR-WORKSPACE.md), using a bounded surface overview derived from every usable facet and capped at 200,000 display triangles. This approximation can omit thin features and introduce display gaps. The complete cleaned STL remains separate. The older performance workspace's sparse preview remains capped at 150,000 triangles; full-model performance optimization is blocked for that preview.

The received original stays unchanged with its SHA-256 fingerprint. Inspection runs in a separate bounded process; uploaded bytes are data, not code. Downloads and reports are local, and `.frameshift/` is ignored by Git. Do not commit private robot CAD.

STL contains no reliable assembly hierarchy, joints, units, constraints, or design intent. Selecting units is explicit. A readable or cleaned mesh does not establish mechanical correctness or manufacturing readiness. Missing parts and displaced assemblies require source CAD and human design intent; Earl does not claim to reconstruct them automatically.

Verification: `npm test`; `node tests/stl-viewer-live.mjs`. Real-file evidence is saved locally under `.frameshift/stl-checks/`; a fixture passing does not establish that a different robot file works.

Teammates: **feature branches and pull requests only. Never push directly to main.**
