Connect a project — FrameShift 0.2

AUTOMATIC INTEGRATION

Vite + Three.js WebGL projects no longer need a handwritten benchmark adapter.
Install the project's normal dependencies, then enter its absolute path in
Connect project. FrameShift detects the framework, entry point, installed Three.js
version, source modules, and local import graph. Review compatibility information
before connecting. Next.js and WebGPU execution are currently unsupported.

The worker copies application source into a local workspace. It runs the real
production build, then attaches a protected Vite profiler plugin in the copy.
Your original source stays unchanged until you explicitly Apply an accepted patch.
Build errors appear with their logs in Run details.

SDK SOURCE

sdk/ contains the installable @frameshift/vite package. Automatic connection uses
it internally; manual installation is optional. To integrate it explicitly:

  npm install --save-dev /absolute/path/to/frameshift/sdk

  import { frameShiftPlugin } from '@frameshift/vite';
  export default { plugins: [frameShiftPlugin()] };

The observer attaches to Three.js WebGLRenderer without requiring application
source changes. It records actual scene matrices, names/identities, draw counts,
application rAF callback CPU time, render submission, picking, and optional GPU
queries. Controlled clocks/randomness activate only in benchmark pages using
?__frameshift=1. Normal previews keep normal application behavior.

RECORDED INTERACTIONS

Use Record actions in an automatically integrated project, click/drag/use keys
in its scene, then save. Replays support up to 80 events over 60 seconds. They
use normalized canvas coordinates and real browser input. Application output,
selection/status DOM and scene state are compared after replay. Legacy manual
examples cannot record these new SDK events.

VERIFICATION

Default checks cover eight times/views, every discovered semantic object's
matrix, 40 raycasting probes, and saved recorded actions. Camera paths use
fixed initial bounds; candidate captures replay exact reference camera states.
Guards cover sampled states, not all possible application behavior.

A frameshift.config.json is optional for customizing build commands, editable
modules, checkpoints and tolerances. Existing manual adapters remain supported.
Only application JS/TS modules are editable. The SDK, benchmarks, tests, build
configuration, environment files and dependencies remain protected.

MEASUREMENTS

CPU callback/submission time is distinct from GPU execution time. GPU utilization
and energy use are not measured. rAF intervals in the controlled harness do not
prove displayed FPS. Repeated A/B then B/A measurements retain raw data and an
observed variability band. Small or noisy changes are inconclusive.

EXECUTION

A separate worker owns the durable queue. Restarting the web interface preserves
jobs. Worker restart resumes safe checkpoints and retains interrupted attempts.
macOS builds have tested file/network restrictions and sanitized credentials.
Other platforms use a sanitized child process without the same OS restrictions.
This is a local single-user tool for trusted projects, not an audited service for
executing hostile repositories.

PROVIDERS

Settings supports OpenAI Responses and compatible Chat Completions endpoints.
The coding provider must support function/tool calls. Keys stay in the local
backend; the model can inspect allowlisted source but has no shell command tool.
