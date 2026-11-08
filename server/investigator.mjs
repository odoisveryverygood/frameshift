// Separate model context and read-only tool allowlist; no source edits are exposed.
import { proposeExperiment } from "./agent.mjs";
export async function investigateProject(options = {}) {
  return proposeExperiment({ ...options, role: "investigator", config: {
    ...options.config,
    // A multi-module app can consume six rounds before its first submission.
    // Keep room to correct a rejected brief without weakening source validation.
    agentMaxRounds: Math.min(options.config?.agentMaxRounds || 10, 10),
    agentMaxToolCalls: Math.min(options.config?.agentMaxToolCalls || 24, 24),
    agentOutputTokens: Math.min(options.config?.agentOutputTokens || 3000, 4000),
  } });
}
