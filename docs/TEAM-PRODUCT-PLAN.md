# Earl: teammate guide and implementation plan

**Read this first.** Earl turns a performance complaint about a local 3D app into a focused code change with measured evidence. The goal is a simple product, with three collaborating specialists behind it.

Updated November 7, 2026. This document describes the agreed target; it does not claim every feature below already exists.

## Current status: what you can honestly demo

| Area | Verified now | Still to build or verify |
|---|---|---|
| Core Earl | Local Vite + Three.js discovery, preview, tool-based source edits, isolated candidates, deterministic checks, paired benchmarks and receipts are implemented. | Recheck the complete user journey after the redesign and sponsor wiring. |
| Skill Lab | Executable transformer learning and bounded authored cross-project evaluation have recorded local evidence. | Integrate as an advanced feature; do not claim universal optimization or model training. |
| Meta | Planned Investigator and Optimizer provider. | User is obtaining credentials. No live Meta tool-loop result yet. |
| Subquadratic | Planned structured risk decisions that add verification cases. | User is obtaining credentials. No live decision-to-test integration yet. |
| Fetch uAgents | SDK 0.26.1 installed locally; three stable identities exchanged typed messages using real in-process SDK dispatch. | Connect handlers to real Earl jobs; duplicate/stale handling and remote transport are not yet verified. |
| Agentverse | Google sign-in completed; authenticated My Agents page verified. | No public agents registered. Current launch flow needs a running public endpoint; mailbox deployment is an alternative to investigate. |
| ASI:One | Account created; approved backend key saved privately; live asi1-mini check returned HTTP 200 and EARL_OK. | This is connectivity proof, not an ASI-powered optimization or Agentverse discovery result. |

Credentials and seed files are deliberately absent from GitHub. Each teammate configures their own backend environment or uses an owner-managed runner. See [setup status](../integrations/SETUP-STATUS.md), [local Fetch setup and evidence](../integrations/fetch/README.md), and [Skill Lab evidence boundaries](SKILL-LAB.md).

## Team ownership and pull-request rules

**Do not push to main. Push your feature branch and open a PR. The owner reviews and merges.** Never commit keys, identity seeds, local runtime data, or node_modules.

| Owner | Work to do | Completion proof |
|---|---|---|
| Teammate 2 — UI | Build the scene-first interface described below. One goal input, one primary action, truthful agent activity, and Compare / View code / Apply. Put logs and metrics in drawers; put Skill Lab under Advanced. Coordinate API contracts with the owner; do not invent progress or sponsor results. | Run against the actual backend, including empty project, running, rejected, failed, cancellation and review states. Check desktop and narrow screens. |
| Teammate 3 — readiness | Own project doctor, clear dependency/build errors, portable Orbit Lab fixture and fresh-checkout smoke checks. Document one reliable demo path and useful failures. | Fresh supported fixture connects, builds and previews; malformed path, missing dependencies, unsupported project and build failure have actionable output. |
| Owner — core | Agent contracts, Meta tool loops, SubQ adapter, Fetch worker bridge, protected verifier, idempotency, cancellation and sponsor evidence. | One real optimization traverses the three roles; risky patch triggers added tests; bad candidate is rejected; actual providers and artifacts are recorded. |

Existing teammate readiness work is in [PR #3](https://github.com/odoisveryverygood/frameshift/pull/3). Coordinate overlapping edits before implementation. Earlier team assignments are in [PR #1](https://github.com/odoisveryverygood/frameshift/pull/1); this guide updates the product direction. Skill Lab work is in [PR #2](https://github.com/odoisveryverygood/frameshift/pull/2).

## How to explain the sponsor integrations

Use present tense only for verified work. For the target architecture: **Meta investigates and writes the patch; Subquadratic identifies patch risks that cause additional tests; Fetch provides typed specialist handoffs and an independently callable verifier; Agentverse makes that verifier reachable/discoverable; ASI model inference is optional and separate.**

Today: Fetch's local handoff and ASI's API connectivity are verified. Meta, SubQ, remote Agentverse messaging and public discovery are planned. The deterministic verifier, not a model confidence score, decides acceptance. Do not present all of these as completed sponsor integrations.

## Full agreed plan

**The plan is one simple product: open your 3D app, describe the slowdown, and receive a tested improvement from three collaborating agents.** Meta powers investigation and coding, Subquadratic guides independent verification, and Fetch handles agent communication.

The existing Skill Lab becomes an advanced learning feature inside that product. It should not be the default workflow everyone has to wait through.

**1. API keys and accounts we need**

| Service | What we need | Purpose |
|---|---|---|
| **Meta Model API** | An API key, available credits, and access to a tool-capable model. We’ll use the official `MODEL_API_KEY` naming. | Investigator and Optimizer. They share the account but have separate conversations and permissions. |
| **Subquadratic** | `SUBQ_API_KEY`, credits, and access to `subq-snap-1.1`. | Structured patch-risk assessment and verification routing. |
| **Fetch.ai uAgents** | Locally generated private identity seeds for the three agents. | Stable agent identities and typed communication. |
| **Agentverse** | Account and mailbox configuration for the agents we publish. | Remote agent communication and discoverability. |
| **ASI:One model API** | Optional inference key. | Needed only if we choose to use its model; local uAgents do not require it. |
| **Existing OpenAI configuration** | Already available from our previous runs. | Development/fallback mode, explicitly labeled with its actual provider. |

Meta documents OpenAI-compatible API surfaces, but we will test our actual tool loop before claiming compatibility. [Meta setup](https://dev.meta.ai/docs/quickstart).

SubQ Snap is available for structured decisions; its text-generation models have separate access requirements. We can build the planned verifier without depending on that early access. [Subquadratic setup](https://docs.subq.ai/).

Fetch identities and Agentverse mailboxes are separate from model inference credentials. Each published local agent needs its own mailbox setup. [uAgents](https://github.com/fetchai/uAgents), [mailboxes](https://uagents.fetch.ai/docs/agentverse/mailbox).

Keys and identity seeds stay in ignored local configuration. They will not appear in GitHub, browser responses, screenshots, or run reports. We don’t need Google or MongoDB credentials for this scope.

**2. Repos we’ll use—and what each contributes**

| Repository | Planned use |
|---|---|
| [Fetch.ai uAgents](https://github.com/fetchai/uAgents) | Three addressable agents, typed messages, protocol handlers, and optional Agentverse publication. |
| [ts-morph](https://github.com/dsherret/ts-morph) | Inspect JavaScript/TypeScript syntax, follow relevant declarations, and perform more precise changes. |
| [fast-check](https://github.com/dubzzz/fast-check) | Generate repeatable supported interaction cases and reduce failures to smaller reproductions. |
| [Playwright](https://github.com/microsoft/playwright) | Keep our existing browser execution, interaction replay, screenshots, and assertions. |
| [Spector.js](https://github.com/BabylonJS/Spector.js) | Keep our existing frame capture and expose useful WebGL findings to the Investigator. |
| Existing Earl code | Preserve useful discovery, instrumentation, isolated copies, benchmarks, receipts, and worker execution. |

These cover the needed capabilities. I would defer LangGraph while using Fetch for handoffs, and defer an OpenHands server migration. That keeps the first implementation to our existing Node backend plus a small Python agent service.

We’ll preserve licenses and attribution for reused code. A repo’s presence in the project will not count as a completed integration.

**3. What makes these three real agents**

| Agent | Inputs and tools | Required output |
|---|---|---|
| **Investigator** | Goal, baseline measurements, source search, dependency information, frame diagnostics. Read-only source access. | A bottleneck hypothesis, supporting evidence, relevant files, and a measurable objective. |
| **Optimizer** | Investigation brief and permitted source files. Writes only to an isolated candidate. | A focused patch, explanation, changed-file list, and candidate hash. |
| **Verifier** | Original behavior contract, original source, patch, and candidate. Owns protected tests and evaluation artifacts. | Passed, rejected, or inconclusive, with measurements and reproducible evidence. |

Each agent gets a separate context and tool allowlist. The Verifier does not receive the Optimizer’s explanation as trusted instructions.

Fetch carries messages such as:

```text
InvestigationReady → PatchReady → VerificationRequested → VerificationResult
```

Every message identifies the job and source/candidate revision. Duplicate messages must not start duplicate builds. Results for an outdated candidate must be rejected.

The Node worker remains responsible for durable job state, execution, cancellation, and recovery.

**4. How Subquadratic meaningfully changes verification**

Subquadratic receives relevant source, the patch, and the behavior contract. It returns structured risk decisions, such as:

- Changes object identity or selection.
- Changes animation or parent transforms.
- Groups potentially incompatible geometry/materials.
- Touches timing or measurement-related behavior.

Those decisions add concrete tests. For an instancing patch, Earl could test selection across several instances, moving parents, and different geometry shapes.

SubQ Snap supports named yes/no, choice, and score outputs. Our application turns those outputs into bounded test plans. [Decisions API](https://docs.subq.ai/endpoints/decisions-api).

**Fixed correctness checks always run. Subquadratic cannot remove them or approve a patch through confidence alone.** Executed tests and performance rules determine acceptance.

**5. How Fetch fits beyond carrying notifications**

The Verifier should be independently callable:

- The full team can investigate, optimize, and verify.
- Another approved agent can submit an existing candidate directly for verification.

That second flow is the meaningful Fetch capability: Earl becomes a verification specialist other agents can use.

We’ll first prove local agent-to-agent communication. Then configure Agentverse and verify an actual external request/response. Local messages alone will not be presented as proof of public discovery.

Agents exchange job IDs and artifact references. External messages cannot supply an arbitrary filesystem path or authorize code execution on your laptop.

**6. Project connection: make it dependable first**

The first supported connection method should be **Open project**, with a folder browser backed by Earl’s local runner.

That avoids making people copy long paths. The backend knows which folder was selected; we aren’t pretending a browser file handle automatically supplies a backend filesystem path.

After selection, Earl should:

1. Detect the framework, engine, entry point, build command, and dependencies.
2. Display a specific blocker if the project cannot run.
3. Build an isolated copy.
4. Open the actual application preview automatically.

The first release remains focused on **local Vite + Three.js WebGL**. ZIP import can be a later, separately tested feature. The original source changes only after Apply.

**7. The interface should have one clear flow**

The default screen contains:

- A small header with the project name and settings.
- A large running application.
- A narrow activity/conversation rail.
- One prompt: **“What feels slow?”**
- One primary action: **Improve performance**.

The rail shows actual progress:

> Investigator found repeated mesh submissions.
> Optimizer is trying instancing.
> Verifier is checking selection and animation.

The result offers **Compare · View code · Apply**. Detailed metrics, receipts, logs, and agent communication open when requested.

“Show Earl” records a short interaction. The recording becomes part of the verification contract.

Skill learning sits under **Advanced → Learn a reusable skill**. It uses the existing cross-project evaluation machinery when requested, instead of adding that cost to every optimization.

**8. How we reduce waiting**

- Default to **one candidate**, with at most two targeted repairs.
- Run source investigation and test planning concurrently where their inputs allow it.
- Keep browser performance measurements sequential.
- Cache unchanged build artifacts and correctness evidence using source, dependencies, scenario, and instrumentation versions.
- Use fresh paired performance measurements for the final decision.
- Avoid an extra model “supervisor” call to choose an already-known next step.
- Put explicit timeouts on model requests, builds, and browser operations.
- Show real phase changes and actionable failures instead of invented progress percentages.

We’ll measure where time is actually spent before promising a particular completion time.

**9. Build order and proof required**

| Step | Completion requirement |
|---|---|
| Connection and preview | Fresh supported project opens; invalid paths, missing dependencies, unsupported frameworks, and build errors are understandable. |
| Fetch handoffs | All three identities exchange real messages; duplicate and stale requests are handled correctly. |
| Meta agents | A live investigation and patch are produced through actual tools. |
| Subquadratic verifier | A live risk decision causes additional tests to execute and produces inspectable evidence. |
| Unified interface | Someone unfamiliar with Earl can connect, run, compare, and apply without an explanation. |
| Learning integration | A reusable skill is adopted only after the separate evaluation gate passes. |

We must also exercise cancellation, provider outages, malformed responses, conflicting source edits, and a rejected candidate. Sponsor mode must report missing sponsor access clearly; it must never silently substitute another provider and claim sponsor success.

**10. Team ownership and GitHub**

- **Teammate 2:** simplified interface and presentation.
- **Teammate 3:** project diagnostics, portable demo, and smoke checks.
- **You and this core implementation:** agent contracts, sponsor adapters, independent verification, execution, and integration.

All work goes through feature branches and PRs. No direct pushes to `main`. Existing work and new event contributions remain distinguishable.

**The first implementation gate is working project connection plus live sponsor credential checks.** Then we connect the three agents around one real optimization. See the status table above for what has actually been verified so far.
