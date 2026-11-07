# FrameShift automatic observer

FrameShift injects this SDK at build time with its Vite plugin. Your original
project is not modified. The installed Three.js WebGLRenderer export is observed;
ordinary Three.js and React Three Fiber share that renderer path.

The SDK records real renderer counters, complete animation callback CPU duration,
separate render-submission duration, semantic world matrices, raycast probes and
optional disjoint GPU timer queries. Controlled benchmark pages use
`?__frameshift=1`, a fixed random seed and simulation clock; elapsed timings always
use the saved native clock. Normal previews retain the application's native clock.

Stable identities use userData.semanticId, userData.frameshiftId, object names,
or scene hierarchy paths. An instancing optimization must supply semanticIds in
instance order to preserve existing identities.

The observer exposes window.__frameshift.step/sample/gpuSample/listObjects.
Additional views are camera requests; an application camera controller may override
them, so returned camera coordinates are evidence of the camera actually used.
Scenario times must advance monotonically; reload the page to rewind. Physics or
external-state applications may require custom resets and assertions.

Interaction recording reports actual pointer/key events relative to the canvas.
Playback should use browser input, then compare application DOM assertions in
addition to SDK picking state. SDK selection alone does not prove application
selection behavior. Legacy handwritten adapters remain supported separately.

This integration supports WebGLRenderer and Vite. It does not claim automatic
Next.js or Three.js WebGPU instrumentation.
