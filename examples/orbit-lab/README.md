# Orbit Lab

An authored, standalone Vite + Three.js WebGL2 application. Four rings contain
240 individually named animated satellites and a clickable central Beacon.
Click an object to change the visible selection; Pause/Resume freezes/restarts
orbital motion. Resize the window or embed it in a narrow viewport. Keyboard:
Tab to the canvas, Enter selects Beacon, Escape clears selection.

Requirements: Node.js 22+, npm, and a browser with working WebGL2.
From **this directory**, without an Earl installation:

```sh
npm ci
npm run dev
# Open the local URL Vite prints. Ctrl-C stops it.
npm run build
npm run preview
```

The production output is `dist/`. Geometry, colors and motion are authored here;
there are no external assets, asset URLs, network requests, model calls or manual
profiler adapters. Earl injects its existing automatic observer in its own copy.
The source does not import Earl or expose synthetic benchmark results.

This is deliberately a rendering optimization exercise: each satellite owns its
own ordinary geometry/material/mesh. Potential experiments include geometry and
material reuse or batching, but no optimized replacement is supplied. Preserve
all object names, orbital transforms, click selection/highlight, visible output,
pause/resume, keyboard behavior and responsive framing. Do not remove satellites,
freeze animation, weaken correctness checks or claim an unmeasured speedup.

See `../../docs/team/teammate-3-readiness.md` for doctor and live smoke commands.
