export const PENDING_OPTIMIZATION_KEY = 'sift:pending-optimization';
export function readPendingOptimization(storage = globalThis.sessionStorage) {
  try {
    const value = JSON.parse(storage.getItem(PENDING_OPTIMIZATION_KEY) || 'null');
    return value && typeof value.projectId === 'string' && value.projectId &&
      typeof value.profileRunId === 'string' && value.profileRunId && typeof value.mission === 'string'
      ? value : null;
  } catch { return null; }
}
export function savePendingOptimization(value, storage = globalThis.sessionStorage) {
  try { storage.setItem(PENDING_OPTIMIZATION_KEY, JSON.stringify(value)); return true; }
  catch { return false; }
}
export function clearPendingOptimization(storage = globalThis.sessionStorage) {
  try { storage.removeItem(PENDING_OPTIMIZATION_KEY); } catch {}
}
export function pendingProfile(intent, runs) {
  return intent && runs.find(run => run.id === intent.profileRunId && run.projectId === intent.projectId && run.kind === 'profile');
}
