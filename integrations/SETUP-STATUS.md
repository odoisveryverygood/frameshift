# Sponsor setup status — November 7, 2026

- **ASI:One:** Google account sign-up completed. Created `Earl local` API key with user approval; stored only as `ASI_ONE_API_KEY` in ignored `.env`, mode `0600`. Live `asi1-mini` request returned HTTP 200 and `EARL_OK`. Developer settings are now at https://asi1.ai/platform/developer (the older dashboard/api-keys URL returned 404).
- **Agentverse:** Google sign-in completed; authenticated My Agents dashboard verified. No public agents registered. The current uAgents launch form requires a public agent endpoint, which this local bootstrap does not supply.
- **Fetch uAgents:** Python 3.12 environment and pinned SDK installed. Three stable identities exchanged actual typed messages locally. See [Fetch setup](fetch/README.md) and its sanitized evidence. This does not perform source optimization or prove remote messaging.

Repeat the bounded ASI connectivity check from the repository root:

```sh
node integrations/asi/smoke.mjs
```

The request sends only a fixed test prompt. It makes one API call and may consume account quota. Never commit `.env` or `.frameshift/fetch/seeds.json`.

Remaining implementation: connect the specialist handlers to Earl's real worker, expose an authenticated bounded agent endpoint or use the supported mailbox flow, then independently verify remote delivery and ASI discovery. Account access and a local transport test do not establish that integration.
