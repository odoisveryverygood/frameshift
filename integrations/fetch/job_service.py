"""Bounded JSON-lines bridge to real local uAgents handlers; never executes a job."""
import asyncio
import json
import re
import socket
import sys
from datetime import datetime, timezone
from local_agents import agents
from uagents import Context, Model

STAGES = {'InvestigationReady': ('investigator', 'optimizer', 0),
          'PatchReady': ('optimizer', 'verifier', 1),
          'VerificationResult': ('verifier', 'investigator', 2)}
HASH = re.compile(r'^[a-f0-9]{64}$')
ID = re.compile(r'^[a-zA-Z0-9_:-]{1,100}$')

class JobHandoff(Model):
    request_id: str
    stage: str
    job_id: str
    attempt: int
    source_hash: str
    candidate_hash: str
    artifact_hash: str


def emit(value):
    print(json.dumps(value, separators=(',', ':')), flush=True)


async def run():
    roles = agents()
    contexts, pending, states, latest = {}, {}, {}, {}
    for role, agent in roles.items():
        def add_handlers(role, agent):
            @agent.on_event('startup')
            async def ready(ctx: Context):
                contexts[role] = ctx

            @agent.on_message(model=JobHandoff)
            async def receive(ctx: Context, sender: str, message: JobHandoff):
                future = pending.get(message.request_id)
                if not future or future.done():
                    return
                try:
                    origin, destination, index = STAGES[message.stage]
                    if role != destination or sender != roles[origin].address:
                        raise ValueError('Unexpected agent sender or destination')
                    key = (message.job_id, message.attempt)
                    previous = latest.get(message.job_id)
                    if previous is not None and message.attempt < previous:
                        raise ValueError('Stale attempt')
                    if previous is not None and message.attempt > previous and states[(message.job_id, previous)]['next'] != 3:
                        raise ValueError('Previous attempt is incomplete')
                    state = states.get(key, {'next': 0, 'source': message.source_hash})
                    if state['next'] != index:
                        raise ValueError('Duplicate or out-of-order handoff')
                    if state['source'] != message.source_hash:
                        raise ValueError('Stale source revision')
                    if index == 2 and state.get('candidate') != message.candidate_hash:
                        raise ValueError('Stale candidate revision')
                    if index == 1:
                        state['candidate'] = message.candidate_hash
                    state['next'] = index + 1
                    states[key] = state
                    latest[message.job_id] = message.attempt
                    future.set_result({'type': 'receipt', 'requestId': message.request_id,
                        'stage': message.stage, 'jobId': message.job_id,
                        'attempt': message.attempt, 'sourceHash': message.source_hash,
                        'candidateHash': message.candidate_hash,
                        'artifactHash': message.artifact_hash,
                        'sender': sender, 'recipient': roles[role].address,
                        'mode': 'local-in-process-uagents-dispatch',
                        'utc': datetime.now(timezone.utc).isoformat()})
                except (KeyError, ValueError) as error:
                    future.set_exception(error)
        add_handlers(role, agent)

    original_connect = socket.socket.connect
    def no_network(*args, **kwargs):
        raise RuntimeError('Network disabled for local agent service')
    socket.socket.connect = no_network
    try:
        for agent in roles.values():
            agent.setup()
        for _ in range(100):
            if len(contexts) == 3:
                break
            await asyncio.sleep(.01)
        if len(contexts) != 3:
            raise RuntimeError('Agent contexts did not start')
        emit({'type': 'ready', 'addresses': {r: a.address for r, a in roles.items()},
              'mode': 'local-in-process-uagents-dispatch'})
        while True:
            line = await asyncio.to_thread(sys.stdin.buffer.readline, 4097)
            if not line:
                break
            request_id = None
            try:
                if len(line) > 4096 or not line.endswith(b'\n'):
                    raise ValueError('Message too large')
                data = json.loads(line)
                allowed = {'requestId','stage','jobId','attempt','sourceHash','candidateHash','artifactHash'}
                if set(data) - allowed:
                    raise ValueError('Unknown handoff fields')
                request_id = data.get('requestId')
                if not isinstance(request_id, str) or not ID.fullmatch(request_id):
                    raise ValueError('Invalid request identifier')
                if data.get('stage') not in STAGES:
                    raise ValueError('Invalid stage')
                if not isinstance(data.get('jobId'), str) or not ID.fullmatch(data['jobId']):
                    raise ValueError('Invalid job identifier')
                if type(data.get('attempt')) is not int or not 0 <= data['attempt'] <= 100:
                    raise ValueError('Invalid attempt')
                if not isinstance(data.get('sourceHash'), str) or not HASH.fullmatch(data['sourceHash']):
                    raise ValueError('Invalid source hash')
                for field in ('candidateHash', 'artifactHash'):
                    value = data.get(field, '')
                    if not isinstance(value, str) or (value and not HASH.fullmatch(value)):
                        raise ValueError('Invalid artifact hash')
                if data['stage'] != 'InvestigationReady' and not data.get('candidateHash'):
                    raise ValueError('Candidate hash required')
                if len(states) >= 1000 and (data['jobId'],data['attempt']) not in states:
                    raise ValueError('Service job capacity reached')
                message = JobHandoff(request_id=request_id, stage=data['stage'],
                    job_id=data['jobId'], attempt=data['attempt'], source_hash=data['sourceHash'],
                    candidate_hash=data.get('candidateHash',''), artifact_hash=data.get('artifactHash',''))
                future = asyncio.get_running_loop().create_future()
                pending[request_id] = future
                origin, destination, _ = STAGES[data['stage']]
                await contexts[origin].send(roles[destination].address, message)
                receipt = await asyncio.wait_for(future, 5)
                emit(receipt)
            except Exception as error:
                emit({'type': 'error','requestId': request_id,
                      'error': str(error)[:200] or type(error).__name__})
            finally:
                if request_id:
                    pending.pop(request_id, None)
    finally:
        await asyncio.gather(*(agent._shutdown([]) for agent in roles.values()))
        socket.socket.connect = original_connect

if __name__ == '__main__':
    asyncio.run(run())
