# Fetch local verification

As of 2026-11-07; branch `feat/executable-skill-lab`. Scope: identity persistence
and local typed uAgents transport only.

| Check | Mode | Expected and observed | Status | Evidence |
|---|---|---|---|---|
| Three-role message round trip | local | Each expected sender and run ID accepted; completion returned to Investigator | passed | `local-smoke-evidence.json` |
| Stable identities | local | Two consecutive runs returned identical public addresses from the same ignored seeds | passed | setup terminal and saved public addresses |
| External networking during handoff | local | Socket connect rejects all connections; local dispatch still completes | passed | `local_agents.py` and evidence |
| Agentverse mailbox registration | live | Account and mailbox link required | not_run | parent handles account website |
| ASI model call | live | Separate provider key and model required | not_run | no model calls in this bootstrap |
| Earl optimization pipeline | local | Project editing and benchmarks required | not_run | explicitly outside bootstrap scope |

The first development run completed delivery but reported incorrect reply
declarations for forwarded messages. Those declarations were removed; the final
run completed with no SDK warnings or errors. The latest saved evidence is the
clean run. There are no listeners or remote resources to clean up. The venv and
private identity file remain under ignored `.frameshift/fetch/`.

Next action: complete account setup, then implement mailbox serving around these
identities and verify a real remote message independently. This evidence does
not establish remote reachability, optimization quality or sponsor eligibility.

## Worker bridge verification

On November 7, 2026, `node --test tests/fetch-bridge.test.mjs` passed both tests
against the installed uAgents 0.26.1 runtime. Actual ordered messages produced
receipts; duplicates, premature stages, stale source/candidate/attempts and
starting a repair before the previous result were rejected. A canceled job
closed its process and rejected subsequent work. These checks concern local
transport. The root integration must separately exercise a real Earl job.
