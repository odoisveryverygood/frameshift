# Earl repair workspace

Connect → Robot STL → inspect → Open repair workspace. Existing imports open at `/repair?import=IMPORT_ID`.

The viewport is the workspace. Choose a separated group suggested by Earl, or select a bounding region yourself. Earl scans the complete source to ensure that the box selects whole triangles and does not cut through any surface. Suggested groups are geometric regions, not recognized CAD parts.

Two explicit placement operations are available:

- **Mounting alignment:** mark three or more non-collinear source/target pairs in source export units. A rigid solver calculates rotation and translation with scaling and reflection prohibited. Poor fits are rejected. Preview picks are approximate and must be checked against the intended mounting features.
- **Measured-gap proposal:** for two host-measured separated groups, propose a translation until their axial bounds touch. This is an **unconfirmed placement proposal**, not inferred mounting-hole alignment. Review it before use. A zero gap does not establish mechanical fit.

Preview switches to Candidate automatically. After placement confirmation, a separate bounded process writes a complete binary STL and an independent pass verifies every facet: unchanged count/header/attributes, exact unchanged bytes outside the region, finite transformed vertices, and correctly rotated normals. Gap proposals also check the resulting axial interval separation. Full-resolution geometry is never replaced by the display overview.

The exported candidate is read again to derive its own overview. The browser fetches that result and switches to it automatically; it does not present a local animation as the exported artifact. Original/Candidate share the same camera. Saved candidates reopen at `/repair?import=IMPORT_ID&candidate=CANDIDATE_ID`.

## Repair agent

The live Gemini Repair agent has bounded tools to read the actual import report, measure the selected region, calculate a user-landmark alignment, or propose a measured axial gap closure. It cannot invent user mounting correspondences, run arbitrary commands, export files, or approve verification. Provider failures stay visible. Deterministic geometry tools work without a model. Agent requests share the existing estimated Gemini application budget.

The new alignment solver uses [ml-matrix](https://github.com/mljs/matrix); viewport picking uses [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh). Both are MIT-licensed dependencies. Parts catalogs were researched, but this version does **not** claim automatic vendor-part recognition, missing-part reconstruction, or a downloaded CAD catalog. No new model key is required.

## Verification and limits

Run `npm test` and `npm run build`. File-backed tests cover rigid fits, invalid/reflected/scaled fits, whole-file transforms, independent tamper detection, boundary-cut rejection, source-bound plans, confirmation, gap proposals, and exported preview generation. Browser checks exercise actual picking, numerical point entry, candidate preview, independent export, and loading the backend artifact.

Private local evidence is under `.frameshift/stl-checks/`. It includes an actual 12.8-million-triangle robot overview and a controlled full-size transformation test that leaves every robot facet untouched while moving four authored test facets. Those controlled tests do not prove an intended robot assembly pose.

**Not established:** general collision clearance, fastener compatibility, structural integrity, arbitrary hole filling, missing mechanical geometry, manufacturing suitability, or intended mounting position. Source CAD or a human-confirmed reference remains necessary for those claims. Preserve the received original. No private CAD or credentials belong in Git.

Teammates: feature branches and PRs only; no push to main. Current changes must not be pushed until the user asks.
