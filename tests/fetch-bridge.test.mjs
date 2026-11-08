import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createFetchBridge } from '../server/fetch-bridge.mjs';
const runtime = existsSync(new URL('../.frameshift/fetch/venv/bin/python', import.meta.url));
const base = { jobId: 'test:job', attempt: 0, sourceHash: 'a'.repeat(64) };
const candidate = { ...base, candidateHash: 'b'.repeat(64) };
test('actual uAgents bridge authenticates ordered handoffs and rejects duplicate/stale messages', { skip: !runtime, timeout: 15000 }, async () => {
  const bridge = await createFetchBridge();
  try {
    await assert.rejects(bridge.handoff({ ...candidate, stage: 'PatchReady' }), /out-of-order/);
    const first = await bridge.handoff({ ...base, stage: 'InvestigationReady' });
    assert.equal(first.sender, bridge.addresses.investigator);
    assert.equal(first.recipient, bridge.addresses.optimizer);
    assert.equal(first.mode, 'local-in-process-uagents-dispatch');
    await assert.rejects(bridge.handoff({ ...base, stage: 'InvestigationReady' }), /Duplicate/);
    await assert.rejects(bridge.handoff({ ...candidate, stage: 'PatchReady', sourceHash: 'c'.repeat(64) }), /Stale source/);
    await bridge.handoff({ ...candidate, stage: 'PatchReady' });
    await assert.rejects(bridge.handoff({ ...candidate, stage: 'VerificationResult', candidateHash: 'c'.repeat(64) }), /Stale candidate/);
    await assert.rejects(bridge.handoff({ ...base, attempt: 1, stage: 'InvestigationReady' }), /incomplete/);
    const last = await bridge.handoff({ ...candidate, stage: 'VerificationResult', artifactHash: 'd'.repeat(64) });
    assert.equal(last.sender, bridge.addresses.verifier);
    assert.equal(last.artifactHash, 'd'.repeat(64));
    await bridge.handoff({ ...base, attempt: 1, stage: 'InvestigationReady' });
    await assert.rejects(bridge.handoff({ ...candidate, stage: 'VerificationResult' }), /Stale attempt/);
    await assert.rejects(bridge.handoff({ ...base, stage: 'InvestigationReady', sourceHash: '/etc/passwd' }), /Invalid/);
  } finally { await bridge.close(); }
  await assert.rejects(bridge.handoff({ ...base, stage: 'InvestigationReady' }), /closed/);
});
test('cancelled Fetch job terminates transport and rejects further work', { skip: !runtime, timeout: 10000 }, async () => {
  const controller = new AbortController();
  const bridge = await createFetchBridge({ signal: controller.signal });
  controller.abort();
  await assert.rejects(bridge.handoff({ ...base, stage: 'InvestigationReady' }), /closed/);
  await bridge.close();
});
