// Separate model context and read-only tool allowlist; no source edits are exposed.
import { proposeExperiment } from "./agent.mjs";
export async function investigateProject(options = {}) {
  return proposeExperiment({ ...options, role: "investigator", config: {
    ...options.config,
    agentMaxRounds: Math.min(options.config?.agentMaxRounds || 7, 7),
    agentMaxToolCalls: Math.min(options.config?.agentMaxToolCalls || 18, 18),
    agentOutputTokens: Math.min(options.config?.agentOutputTokens || 3000, 4000),
  } });
}
