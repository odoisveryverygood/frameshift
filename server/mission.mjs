/** A mission expresses user intent; it never controls acceptance policy. */
export function normalizeMission(value = "") {
  if (typeof value !== "string") throw Error("Mission must be text");
  const mission = value.trim();
  if (mission.length > 4000) throw Error("Keep your mission under 4,000 characters");
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(mission))
    throw Error("Mission contains unsupported control characters");
  return mission;
}
