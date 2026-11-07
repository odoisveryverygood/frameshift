"""Bounded public-chat tools. No model output controls URLs, paths or acceptance."""
import hashlib
import json
import re
import time
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / '.frameshift' / 'fetch' / 'public'
ID = re.compile(r'^[a-f0-9]{8}-[a-f0-9]{3}$')
TERMINAL = {'completed', 'failed', 'stopped', 'interrupted'}


class SiftTools:
    def __init__(self, project_ids, state_dir=STATE, base='http://127.0.0.1:4310', request=None, max_jobs=8):
        if not project_ids or any(not ID.fullmatch(p) for p in project_ids):
            raise ValueError('Configure explicit authorized project IDs')
        if base != 'http://127.0.0.1:4310':
            raise ValueError('Backend must remain on the fixed loopback address')
        self.projects = set(project_ids)
        self.directory = Path(state_dir)
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.file = self.directory / 'jobs.json'
        self.data = json.loads(self.file.read_text()) if self.file.exists() else {'jobs': {}, 'messages': {}}
        self.base, self.request, self.max_jobs = base, request or self._http, max_jobs

    def _http(self, route, body=None, text=False):
        req = Request(self.base + route, data=json.dumps(body).encode() if body is not None else None,
                      headers={'Content-Type': 'application/json'})
        try:
            with urlopen(req, timeout=25) as response:
                raw = response.read(2_000_001)
                if len(raw) > 2_000_000:
                    raise ValueError('Backend result exceeds the chat transfer limit')
                return raw.decode() if text else json.loads(raw)
        except Exception as exc:
            # Never send raw backend exceptions, source paths or provider diagnostics to strangers.
            raise RuntimeError('Local Sift operation unavailable. The job may still be running; check status before retrying.') from exc

    def save(self):
        tmp = self.file.with_suffix('.tmp')
        tmp.write_text(json.dumps(self.data))
        tmp.chmod(0o600)
        tmp.replace(self.file)

    def list_projects(self):
        state = self.request('/api/state')
        return [{'id': p['id'], 'name': p['name'], 'kind': 'authorized Three.js workload'}
                for p in state['projects'] if p['id'] in self.projects]

    def start(self, owner, message_id, project_id, goal):
        if project_id not in self.projects:
            raise ValueError('Project is not authorized for public chat')
        key = hashlib.sha256((owner + ':' + message_id).encode()).hexdigest()
        if key in self.data['messages']:
            return self.status(owner, self.data['messages'][key])
        if len(self.data['jobs']) >= self.max_jobs:
            raise ValueError('Application job allowance reached; ask the operator to review it')
        if any(j['owner'] == owner and time.time() - j['at'] < 90 for j in self.data['jobs'].values()):
            raise ValueError('Wait before starting another experiment; use status for your current job')
        if not isinstance(goal, str) or not goal.strip() or len(goal) > 2000:
            raise ValueError('Provide a goal under 2,000 characters')
        state = self.request('/api/state')
        if not state.get('worker', {}).get('alive'):
            raise ValueError('Execution worker is offline; no job was started')
        if state.get('activeRun') or any(r['status'] in ('queued', 'running', 'recovering') for r in state['runs']):
            raise ValueError('The measured execution lane is busy; no job was started')
        result = self.request(f'/api/projects/{project_id}/runs', {'kind': 'optimize', 'count': 1, 'mission': goal})
        job_id = result['id']
        self.data['jobs'][job_id] = {'owner': owner, 'project': project_id, 'at': time.time()}
        self.data['messages'][key] = job_id
        self.save()
        return {'jobId': job_id, 'status': result['status'], 'message': 'Real optimization queued; acceptance requires executed verification.'}

    def owned(self, owner, job_id):
        if not ID.fullmatch(job_id or '') or self.data['jobs'].get(job_id, {}).get('owner') != owner:
            raise ValueError('Job is not available to this conversation sender')
        return self.data['jobs'][job_id]

    def status(self, owner, job_id):
        self.owned(owner, job_id)
        r = self.request(f'/api/runs/{job_id}/report')
        notes = ['CPU submission time is not GPU utilization.', 'One local machine; configured checks do not cover all behavior.']
        baseline, best = r.get('baseline') or {}, r.get('best') or {}
        if baseline.get('gpuP95') and best.get('gpuP95', 0) > baseline['gpuP95'] * 1.1:
            notes.append('Sampled GPU p95 increased. Acceptance under the configured draw/CPU policy does not establish a GPU improvement.')
        return {'jobId': r['id'], 'status': r['status'], 'phase': r.get('phase'),
                'baseline': self.metrics(r.get('baseline')), 'best': self.metrics(r.get('best')),
                'experiments': [{'id': e['id'], 'status': e.get('status'), 'candidate': self.metrics(e.get('candidate'))} for e in r.get('experiments', [])],
                'measurementNotes': notes}

    @staticmethod
    def metrics(m):
        if not isinstance(m, dict):
            return None
        return {k: v for k, v in m.items() if k in {'fps', 'frameP95', 'submitP95', 'updateP95', 'drawCalls', 'calls', 'frameMedian', 'submitMedian', 'gpuSupported', 'gpuP95', 'uncertainty', 'triangles', 'geometries', 'textures', 'semanticObjects'}}

    def evidence(self, owner, job_id):
        status = self.status(owner, job_id)
        receipts = []
        for exp in status['experiments']:
            if exp['status'] not in ('accepted', 'rejected'):
                continue
            verdict = self.request(f"/api/runs/{job_id}/experiments/{exp['id']}/verdict")
            # The structured receipt contains measured comparisons and guards, not raw sources.
            allowed = {'status', 'authority', 'performance', 'visual', 'semantic', 'checks', 'guards', 'reason', 'reasons', 'baseline', 'candidate', 'improvement', 'threshold', 'metric', 'checkpoints', 'decision', 'verdict', 'coverage', 'artifacts', 'sources', 'evaluatedAt', 'policyHash', 'referenceRoles'}
            receipts.append({'experimentId': exp['id'], 'verdict': {k: v for k, v in verdict.items() if k in allowed}})
        return {**status, 'receipts': receipts, 'verified': any(r['verdict'].get('verdict', r['verdict']).get('status') == 'accepted' for r in receipts)}

    def patch(self, owner, job_id, offset=0):
        job = self.owned(owner, job_id)
        status = self.status(owner, job_id)
        if status['status'] != 'completed' or not any(e['status'] == 'accepted' for e in status['experiments']):
            raise ValueError('No completed, accepted patch exists for this job')
        state = self.request('/api/state')
        project = next((p for p in state['projects'] if p['id'] == job['project']), None)
        if not project or project.get('lastAcceptedRun') != job_id:
            raise ValueError('Project has advanced; the current patch is not the verified job revision')
        patch = self.request(f"/api/projects/{job['project']}/patch", text=True)
        if not isinstance(offset, int) or offset < 0 or offset > len(patch):
            raise ValueError('Invalid patch offset')
        return {'jobId': job_id, 'sha256': hashlib.sha256(patch.encode()).hexdigest(), 'length': len(patch),
                'offset': offset, 'nextOffset': offset + 7000 if offset + 7000 < len(patch) else None, 'patch': patch[offset:offset + 7000]}
