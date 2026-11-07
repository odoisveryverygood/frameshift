# Earl: local Fetch.ai agents

**Current implementation:** the [worker bridge](#worker-bridge) now carries real performance-job handoffs. The transport-only smoke setup below is retained as a separate bootstrap check; it is not the limit of the current integration. Public Agentverse transport remains unverified. See [the current UI handoff](../../docs/SIFT-UI-HANDOFF.md).

This is a real `uagents==0.26.1` installation and a verified typed local message
handoff between three stable identities. It is an integration bootstrap, not an
implemented performance optimization pipeline. It has no model calls and does
not edit projects. Agentverse registration, ASI credentials and remote messaging
have **not** been verified by this local test.

## Setup and test

Run from the repository root. Python 3.12 is required; the macOS system Python
3.9 is too old for this SDK. `uv` and `/opt/homebrew/bin/python3.12` were available
on the setup machine.

```sh
uv venv --python /opt/homebrew/bin/python3.12 .frameshift/fetch/venv
uv pip sync --python .frameshift/fetch/venv/bin/python integrations/fetch/requirements.lock
.frameshift/fetch/venv/bin/python integrations/fetch/local_agents.py identities
.frameshift/fetch/venv/bin/python integrations/fetch/local_agents.py smoke --evidence integrations/fetch/local-smoke-evidence.json
```

The smoke test has a ten-second deadline. A successful run verifies actual
uAgents model dispatch and the expected sender and run identifier at every
hop. It intentionally sends an empty candidate with `optimization_performed:
false`; it is transport evidence, not a measured optimization result. SDK errors
or failed assertions prevent completion and cause a timeout/nonzero exit.

Identity seeds are generated with Python `secrets` and written only to ignored
`.frameshift/fetch/seeds.json` with permission `0600`. Keep that file private and
preserve it to retain the identities. Never add it to Git, paste it into a hosted
agent editor, or include it in screenshots. Public addresses can be shared.

## Isolation and registration

The smoke run starts no HTTP listener and rejects socket connections while
message tasks execute. Messages use the SDK's in-process dispatcher. No wallet
funding, transactions, Agentverse account, API key or ASI account is needed for
this local check. The SDK derives wallet objects from each seed but this code
never funds or uses them.

Passing `registration_policy=None` **does not disable registration** in this SDK.
`LocalAgent` therefore uses a no-op registration policy and disables the
registration loop. It also overrides the SDK's otherwise unconditional startup
Almanac status request. Mailbox/proxy, inspector, profile publication, lifecycle
telemetry and inactive-status publication are disabled. These overrides depend
on the pinned SDK and must be reviewed before upgrading.

## Agentverse handoff

The public agent addresses are in `local-smoke-evidence.json`. Website account
creation/login and local mailbox linking are separate unfinished steps. An
Agentverse API key is not required for the local smoke check; ASI model access
is a separate credential and must stay on the backend.

For a subsequent mailbox integration, retain the corresponding existing seed
and configure one running agent process per role with `mailbox=True`,
`enable_agent_inspector=True` and a distinct local port: investigator `8001`,
optimizer `8002`, verifier `8003`. Use the documented Agentverse inspector flow
from the logged-in browser to connect each running agent. The pinned SDK builds
inspector URLs in this form:

```text
https://agentverse.ai/inspect/?uri=http%3A//127.0.0.1%3A8001&address=<investigator-public-address>
https://agentverse.ai/inspect/?uri=http%3A//127.0.0.1%3A8002&address=<optimizer-public-address>
https://agentverse.ai/inspect/?uri=http%3A//127.0.0.1%3A8003&address=<verifier-public-address>
```

These URLs are a configuration handoff, not live listeners. The `identities`
and `smoke` commands do not start an inspector or register a mailbox. A remote
runtime should be implemented after account setup and independently verified
for authenticated messages, restart persistence, timeouts and actual Earl job
handoff. Do not enable default ledger registration merely to connect a mailbox.

The eventual handlers must delegate to Earl's real investigation, isolated patch
execution and independent benchmark/verification services; this bootstrap does
not replace those implementations or claim that they exist.

Sources: the installed pinned SDK's `Agent` constructor, `setup`,
`start_registration_loop`, `_update_agent_status`, `start_server`, `_shutdown`,
and `uagents_core.registration.AgentRegistrationPolicy` were inspected directly.
Official upstream: https://github.com/fetchai/uAgents.

## Worker bridge

`server/fetch-bridge.mjs` starts `job_service.py` as a bounded child process for
an Earl job. The owner calls `handoff` at real lifecycle transitions:

```js
const bridge = await createFetchBridge({ signal });
try {
  const receipt = await bridge.handoff({
    stage: 'InvestigationReady', jobId, attempt: 0, sourceHash,
  });
  // After a patch exists: PatchReady with the same sourceHash + candidateHash.
  // After evaluation: VerificationResult with the same hashes + artifactHash.
} finally { await bridge.close(); }
```

The Python process sends the typed message through the actual SDK dispatcher.
The receiving specialist checks the expected sender, job/attempt ordering and
revision hashes before acknowledging. Duplicate stages, stale revisions, prior
incomplete attempts, unknown fields, large messages and missing candidate hashes
are rejected. Node independently matches receipts to the pending request and
expected public identities. Cancellation or a deadline terminates the process.
The subprocess receives no model-provider environment credentials.

The bridge exchanges only job identifiers and hashes; it never accepts a source
path, shell command or remote instruction. It starts no listeners and disables
network socket connections and registration using the same pinned LocalAgent
implementation. Receipts establish local delivery, not remote discovery or
correctness of the artifact named by a hash.

```sh
node --test tests/fetch-bridge.test.mjs
```

These tests exercise the actual installed SDK, including rejected duplicates,
stale source/candidate/attempt messages, ordering failures and cancellation. They
are skipped explicitly if the local Python environment has not been installed.
