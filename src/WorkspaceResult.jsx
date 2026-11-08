import React, { useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowRight, Check, Loader2, ShieldCheck, TriangleAlert } from 'lucide-react';
import { requestApi } from './api-client.mjs';

const metrics = [['Draw calls','calls',0,''],['CPU submission p95','submitP95',1,' ms'],['Frame p95','frameP95',1,' ms']];
const format = (n,d,u) => Number.isFinite(n) ? (d ? n.toFixed(d) : Math.round(n).toLocaleString()) + u : '—';
function conciseReason(text, guards) {
  const raw = String(text || '');
  if (guards?.pass === false || /correctness verification failed/i.test(raw)) {
    const transforms = guards?.checks?.some(check => check.statePass === false || check.firstTransformMismatch);
    return transforms
      ? 'The candidate changed protected object transforms. Your original is unchanged. Open Details to inspect the mismatches.'
      : 'The candidate changed protected scene behavior. Your original is unchanged. Open Details to inspect the failed checks.';
  }
  const first = raw.split('\n')[0].split(/\s*[\{\[]/)[0].trim() || 'The attempt could not complete. Open Details for the recorded error.';
  return first.length > 220 ? first.slice(0, 217) + '…' : first;
}
export default function WorkspaceResult({ project, run, experiment, busy, running, onApply, onDetails, onOptimize, onStart }) {
  const [receipt, setReceipt] = useState(null), [receiptError, setReceiptError] = useState(''), [reading, setReading] = useState(false);
  useEffect(() => {
    setReceipt(null); setReceiptError('');
    if (run?.kind !== 'optimize' || !run.id || !experiment?.id) { setReading(false); return; }
    const controller = new AbortController(); setReading(true);
    requestApi(`/runs/${encodeURIComponent(run.id)}/experiments/${encodeURIComponent(experiment.id)}/verdict`, undefined, { signal: controller.signal })
      .then(value => {
        if (!value.policyHash || !value.evaluatedAt || !value.verdict?.status) throw Error('The verifier receipt is incomplete.');
        if (!controller.signal.aborted) setReceipt(value);
      }).catch(error => { if (!controller.signal.aborted) setReceiptError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setReading(false); });
    return () => controller.abort();
  }, [run?.id, run?.kind, experiment?.id]);
  const verdict = receipt?.verdict?.status;
  const profile = run?.kind === 'profile' && run.status === 'completed' && run.baseline;
  const interrupted = ['failed','stopped','interrupted'].includes(run?.status);
  const correctnessRejected = experiment?.guards?.pass === false;
  const title = interrupted ? ({ failed:'This run needs attention', stopped:'Run stopped', interrupted:'Run interrupted' })[run.status]
    : profile ? 'Baseline ready.'
    : reading ? 'Reading the verification result…'
    : verdict === 'accepted' ? 'A measured improvement.'
    : verdict === 'rejected' || correctnessRejected ? 'Candidate rejected.'
    : verdict === 'inconclusive' ? 'The result is inconclusive.'
    : run?.kind === 'optimize' ? 'No verified improvement yet.'
    : project?.built ? 'Your project is ready.' : 'Build your first preview.';
  const reason = conciseReason(interrupted ? run.error || run.phase
    : receipt?.verdict?.reason || (profile ? 'The actual application is ready to explore. No AI optimization has run yet.'
    : run?.kind === 'optimize' ? experiment?.reason || receiptError || 'No completed verifier receipt is available for this run.'
    : 'Describe what feels slow, then let the agents investigate one focused improvement.'), experiment?.guards);
  const after = experiment?.candidate;
  const before = experiment?.reference || (!after ? run?.baseline : null);
  const current = verdict === 'accepted' && project?.lastAcceptedRun === run?.id && project?.lastAcceptedExperiment === experiment?.id;
  return <section className="workspace-result" aria-label="Run result" aria-live="polite">
    <header><div><span className="eyebrow">{profile ? 'Measured baseline' : run ? 'Run result' : 'Next step'}</span><h1>{title}</h1></div>
      {reading ? <Loader2 size={20} className="spin" /> : verdict === 'accepted' ? <ShieldCheck size={24} /> : interrupted || verdict === 'rejected' || correctnessRejected ? <TriangleAlert size={22} /> : null}</header>
    <p className="workspace-result-reason">{reason}</p>
    {before && !after && <span className="eyebrow">{profile ? "Baseline measurements" : "Reference measurements"}</span>}
    {(before || after) && <div className="workspace-metrics">{metrics.map(([label,key,digits,unit])=><div key={key}><span>{label}</span><b>{format(before?.[key],digits,unit)}{Number.isFinite(after?.[key]) && <><i> → </i>{format(after[key],digits,unit)}</>}</b></div>)}</div>}
    {receipt && <p className="workspace-scope">Deterministic verdict · {receipt.coverage?.checkpoints ?? experiment?.guards?.checks?.length ?? 'Recorded'} checkpoints. Passing checks covers the sampled scenes and interactions.</p>}
    {receiptError && !interrupted && run?.kind === 'optimize' && <p className="workspace-scope">Verification receipt unavailable. Open Details to inspect the recorded errors and evidence.</p>}
    {verdict === 'accepted' && !current && <p className="workspace-scope">Historical result. The current workspace uses a different accepted revision.</p>}
    <div className="workspace-actions">
      {current && <><button className="primary-button" disabled={busy || running} onClick={onApply}>Apply to source <Check size={15} /></button><a className="secondary-button" href={`/api/projects/${encodeURIComponent(project.id)}/patch`} download><ArrowDownToLine size={15} /> Download patch</a></>}
      {!current && <button className="primary-button" disabled={busy || running} onClick={project?.built ? onOptimize : onStart}>{profile ? 'Optimize this project' : project?.built ? 'Try another improvement' : 'Build preview'} <ArrowRight size={15} /></button>}
      <button className="secondary-button" onClick={onDetails}>Details</button>
    </div>
  </section>;
}
