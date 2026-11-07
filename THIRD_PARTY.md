# Third-party acknowledgments

## 3D Web Scene Performance

Source: https://github.com/hiddentao/3d-web-scene-performance-skill
Read snapshot: 2a43ef8af684c7641b12ab83b42afd26a7c6b6dd

The skill text is included as model reference material in vendor/3d-performance.md.
The engine probe and Three.js adapter are included in vendor/probe-engine.mjs and
vendor/adapters/three.mjs. License: vendor/3d-performance-LICENSE (MIT).
The engine probe is a source/internal compatibility probe, not a runtime profiler.

## Artificial General Research (AGR)

Source: https://github.com/JoaquinMulet/Artificial-General-Research
Read snapshot: f4d7db29b395ab95d5f3fb9981115baa9bef22e5

Earl's custom runner (originally FrameShift) adapts AGR's experiment-history, fresh-context,
metric/guard separation, same-window reference and keep/discard concepts.
AGR's CLI and Docker stack are not embedded. License acknowledgment is included
in vendor/agr-LICENSE (MIT). AGR's reported speedups are not Earl results.

## Anatomy (the hero's rocket-engine drawing)

Source: https://github.com/wheresryan22/anatomy (MIT, Copyright (c) 2026 Ryan)
License: vendor/anatomy-LICENSE

public/engine/raptor.png is the Raptor 2 test-stand drawing from anatomy's
examples/raptor-engine, rendered once in Chrome with the plume, labels, controls and
paper background removed (cold, assembled state). The artwork is by the anatomy
project. It is shown on the hero page (src/EngineScene.jsx); the flame, the orange
nozzle glow, the paper-square melt, the hover lift and the sway are authored for Sift
and do not use anatomy's plume shader or code.

## Runtime libraries

Three.js, React, Express, Vite, Playwright Core, Pixelmatch, PNGJS, jsdiff,
Spector.js, dotenv, Lucide, esbuild and their dependencies are installed through
npm and retain their package licenses. See package-lock.json and node_modules.

## Design references

Spline's viewport-and-panel workflow, NASA Eyes' replay/data relationship,
and Unseen/Lusion's cinematic 3D presentation informed the interface direction.
No site source, brand assets, models, or screenshots from those sites are used.
The example scenes and dashboard visuals are authored for FrameShift/Earl.

Earl’s workbench redesign references the user’s Morf project and Rive’s contextual
editor structure. Morf was inspected as an authorized local design reference; its
CAD/circuit backend is not embedded. Rive and Spline site source and assets are not
embedded. OpenHands, pg-boss and Podman were evaluated as possible future foundations;
they are not installed dependencies or claimed integrations.
