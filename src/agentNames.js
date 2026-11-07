// Display names for the agents, in one place. The backend's role strings and event
// types ("investigator", "optimizer", "verifier", ...) are protocol and stay as they
// are; only what people read changes. `subtitle` keeps the backend role name visible
// so teammates can map them.
export const NAMES = {
  investigator: {
    name: "Bottleneck Finder",
    subtitle: "Investigator",
    description:
      "Reads your scene and source code and finds what's slowing it down.",
  },
  optimizer: {
    name: "Patch Writer",
    subtitle: "Optimizer",
    description: "Writes an exact code fix in an isolated copy and builds it.",
  },
  risk: {
    name: "Risk Spotter",
    subtitle: "Verifier · risk step",
    description:
      "Predicts what the fix might break and adds extra checkpoints.",
  },
  verifier: {
    name: "Proof Checker",
    subtitle: "Verifier",
    description:
      "Runs the tests and measurements and decides pass/fail. It is code, not an AI.",
  },
  repair: {
    name: "Part Aligner",
    subtitle: "Repair agent",
    description:
      "Measures robot STL parts and proposes how to move them into place.",
  },
};

// The three typed local handoffs. They are local, never a remote or network call.
export const HANDOFFS = {
  InvestigationReady: `Handoff: findings → ${NAMES.optimizer.name}`,
  PatchReady: `Handoff: patch → ${NAMES.verifier.name}`,
  VerificationResult: `Handoff: result → ${NAMES.investigator.name}`,
};

// Map a backend role, event type or provider name to its display entry.
export function agentFor(value) {
  const v = String(value || "").toLowerCase();
  if (NAMES[v]) return NAMES[v];
  if (v.includes("investigat")) return NAMES.investigator;
  if (v.includes("optimi")) return NAMES.optimizer;
  if (v.includes("subq") || v.includes("risk")) return NAMES.risk;
  if (v.includes("verif")) return NAMES.verifier;
  if (v.includes("repair")) return NAMES.repair;
  return null;
}

// "Patch Writer · muse-spark-1.3": the model comes from the backend, never hard-coded.
export const withModel = (agent, model) =>
  model ? `${agent.name} · ${model}` : agent.name;
