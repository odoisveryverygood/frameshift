/** Real local uAgents transport. Receipts prove delivery, never optimization. */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAGES = new Set(['InvestigationReady', 'PatchReady', 'VerificationResult']);
const HASH = /^[a-f0-9]{64}$/;

export async function createFetchBridge({ signal, timeoutMs = 10000 } = {}) {
  signal?.throwIfAborted();
  const child = spawn(path.join(ROOT, '.frameshift/fetch/venv/bin/python'),
    ['-u', path.join(ROOT, 'integrations/fetch/job_service.py')],
    { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH || '', LANG: process.env.LANG || 'en_US.UTF-8', PYTHONDONTWRITEBYTECODE: '1' } });
  let stopped = false;
  let readyData;
  let resolveReady, rejectReady;
  const pending = new Map();
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  function fail(error) {
    rejectReady(error);
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
    pending.clear();
  }
  function stop(error = new Error('Fetch bridge closed')) {
    if (stopped) return;
    stopped = true;
    clearTimeout(startupTimer);
    signal?.removeEventListener('abort', onAbort);
    fail(error);
    child.stdin.destroy();
    child.kill('SIGTERM');
  }
  const onAbort = () => stop(new Error('Fetch handoff cancelled'));
  const startupTimer = setTimeout(() => stop(new Error('Fetch agent startup timed out')), timeoutMs);
  signal?.addEventListener('abort', onAbort, { once: true });
  child.on('error', () => stop(new Error('Fetch runtime unavailable; install integrations/fetch/requirements.lock in .frameshift/fetch/venv')));
  child.on('exit', () => stop(new Error('Fetch agent process exited')));
  child.stdin.on('error', () => stop(new Error('Fetch agent input closed')));
  // Drain SDK diagnostics; no raw source or provider credentials are returned.
  child.stderr.on('data', () => {});
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    if (line.length > 8192) return stop(new Error('Oversize Fetch response'));
    let data;
    try { data = JSON.parse(line); } catch { return; } // SDK diagnostics are not protocol.
    if (data.type === 'ready') { readyData = data; clearTimeout(startupTimer); resolveReady(data); return; }
    const item = pending.get(data.requestId);
    if (!item) return;
    pending.delete(data.requestId);
    clearTimeout(item.timer);
    if (data.type === 'error') { item.reject(new Error(`Fetch handoff rejected: ${data.error}`)); return; }
    const destinations = { InvestigationReady: ['investigator','optimizer'], PatchReady: ['optimizer','verifier'], VerificationResult: ['verifier','investigator'] };
    const [sender, recipient] = destinations[item.message.stage];
    if (data.type !== 'receipt' || data.mode !== 'local-in-process-uagents-dispatch' ||
        data.sender !== readyData.addresses[sender] || data.recipient !== readyData.addresses[recipient] ||
        ['stage','jobId','attempt','sourceHash','candidateHash','artifactHash'].some(k => (data[k] || '') !== (item.message[k] || ''))) {
      item.reject(new Error('Fetch receipt did not match the current request')); return;
    }
    item.resolve(data);
  });
  await ready;
  return {
    mode: readyData.mode,
    addresses: readyData.addresses,
    async handoff(message) {
      if (stopped) throw new Error('Fetch bridge closed');
      signal?.throwIfAborted();
      if (!STAGES.has(message.stage) || !/^[a-zA-Z0-9_:-]{1,100}$/.test(message.jobId) ||
          !Number.isInteger(message.attempt) || message.attempt < 0 || message.attempt > 100 || !HASH.test(message.sourceHash) ||
          ['candidateHash','artifactHash'].some(k => message[k] && !HASH.test(message[k]))) throw new Error('Invalid Fetch handoff');
      if (Object.keys(message).some(k => !['stage','jobId','attempt','sourceHash','candidateHash','artifactHash'].includes(k))) throw new Error('Unknown Fetch handoff fields');
      const envelope = { requestId: randomUUID(), ...message };
      const encoded = JSON.stringify(envelope);
      if (encoded.length > 4095) throw new Error('Fetch handoff too large');
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => stop(new Error('Fetch handoff timed out')), timeoutMs);
        pending.set(envelope.requestId, { resolve, reject, timer, message: envelope });
        child.stdin.write(encoded + '\n');
      });
    },
    async close() { stop(); },
  };
}
