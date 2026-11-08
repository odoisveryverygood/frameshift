"""Sift public Agentverse/ASI entry point using the pinned Agent Chat Protocol."""
import argparse
import asyncio
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
from uuid import uuid4

from uagents import Agent, Context, Protocol
import uagents.asgi
uagents.asgi.HOST = "127.0.0.1"  # Inspector stays local; inbound chat uses the authenticated mailbox.
from uagents_core.contrib.protocols.chat import ChatAcknowledgement, ChatMessage, EndSessionContent, TextContent, chat_protocol_spec
from sift_tools import SiftTools, STATE

HELP = '''Sift runs real, bounded 3D performance experiments and returns deterministic verification evidence and an accepted patch here in chat.
Commands (send these directly to this agent):
projects
optimize PROJECT_ID: describe the slowdown and behavior to preserve
status JOB_ID
evidence JOB_ID
patch JOB_ID [OFFSET]
No upload, filesystem access or UI visit required for the authorized workload. One experiment per job, eight jobs per operator allowance. The original source is never applied automatically. Timings are CPU submission measurements on one machine, not GPU utilization or universal correctness.'''


def normalize_text(text, address):
    return re.sub(r'^@(?:' + re.escape(address) + r'|sift-3d)\s*', '', text, flags=re.I).strip()


def identity():
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = STATE / 'identity.json'
    if not path.exists():
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, 'w') as f:
            json.dump({'seed': secrets.token_hex(32)}, f)
    path.chmod(0o600)
    return json.loads(path.read_text())['seed']


def make_agent():
    return Agent(name='Sift 3D Performance Engineer', seed=identity(), port=8001,
                 mailbox=True, publish_agent_details=True, handle_messages_concurrently=True,
                 description='Sift investigates authorized Three.js scenes, runs real isolated optimization jobs, independently benchmarks and checks candidates, and returns evidence and verified source patches entirely in ASI:One chat. Start with projects. No invented performance or mechanical correctness claims.',
                 readme_path=str(Path(__file__).with_name('AGENTVERSE.md')))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--identity', action='store_true')
    parser.add_argument('--project', action='append', default=[])
    args = parser.parse_args()
    agent = make_agent()
    if args.identity:
        print(json.dumps({'name': agent.name, 'address': agent.address, 'inspector': f'https://agentverse.ai/inspect/?uri=http%3A//127.0.0.1%3A8001&address={agent.address}'}))
        return
    project_ids = args.project
    if not project_ids:
        config = STATE / 'config.json'
        if not config.exists():
            parser.error('Run npm run fetch:setup to explicitly authorize the public warehouse, or pass --project ID')
        project_ids = json.loads(config.read_text()).get('projectIds', [])
    tools = SiftTools(project_ids)
    lock = asyncio.Lock()
    protocol = Protocol(spec=chat_protocol_spec)

    async def reply(ctx, sender, text, end=True):
        content = [TextContent(type='text', text=text)]
        if end:
            content.append(EndSessionContent(type='end-session'))
        await ctx.send(sender, ChatMessage(timestamp=datetime.now(timezone.utc), msg_id=uuid4(), content=content))

    @agent.on_interval(period=15)
    async def heartbeat(ctx: Context):
        record = {'pid': os.getpid(), 'address': agent.address, 'heartbeat': datetime.now(timezone.utc).isoformat(), 'mode': 'agentverse-mailbox-acp', 'authorizedProjects': sorted(tools.projects)}
        (STATE / 'heartbeat.json').write_text(json.dumps(record))

    @protocol.on_message(ChatMessage)
    async def handle(ctx: Context, sender: str, msg: ChatMessage):
        await ctx.send(sender, ChatAcknowledgement(timestamp=datetime.now(timezone.utc), acknowledged_msg_id=msg.msg_id))
        text = '\n'.join(c.text for c in msg.content if isinstance(c, TextContent)).strip()
        text = normalize_text(text, agent.address)
        # ASI may use a fresh session UUID for a follow-up; ownership stays bound to its authenticated sender.
        owner = hashlib.sha256(sender.encode()).hexdigest()
        action = text.lower().strip(' .?!')
        ctx.logger.info('Sift chat request received; message=%s', str(msg.msg_id))
        try:
            if len(text) > 5000:
                raise ValueError('Keep the request under 5,000 characters')
            if action in ('projects', 'list projects', 'list authorized projects') or ('list' in action and 'project' in action):
                result = await asyncio.to_thread(tools.list_projects)
            elif match := re.fullmatch(r'optimize\s+([a-f0-9-]+)\s*:\s*(.+)', text, re.I | re.S):
                async with lock:
                    result = await asyncio.to_thread(tools.start, owner, str(msg.msg_id), match[1], match[2])
                await reply(ctx, sender, json.dumps(result) + '\nAsk status ' + result.get('jobId', '') + ' to monitor this real job. No pass claimed until verification completes.')
                return
            elif match := re.fullmatch(r'(status|evidence|patch)\s+([a-f0-9-]+)(?:\s+(\d+))?', text, re.I):
                operation, job, offset = match.groups()
                fn = getattr(tools, operation.lower())
                result = await asyncio.to_thread(fn, owner, job, *([int(offset or 0)] if operation.lower() == 'patch' else []))
            else:
                await reply(ctx, sender, HELP)
                return
            await reply(ctx, sender, json.dumps(result, indent=2))
            log = {'at': datetime.now(timezone.utc).isoformat(), 'messageId': str(msg.msg_id), 'operation': action.split()[0] if action else 'help', 'status': 'answered'}
            with (STATE / 'events.jsonl').open('a') as f:
                f.write(json.dumps(log) + '\n')
        except (ValueError, RuntimeError) as exc:
            await reply(ctx, sender, str(exc) + '\n' + HELP)
        except Exception:
            ctx.logger.error('Sift tool execution failed; no success claimed')
            await reply(ctx, sender, 'Sift could not complete that operation. No successful result is claimed. Try status for an existing job, or ask the operator to check the backend.')

    @protocol.on_message(ChatAcknowledgement)
    async def ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
        pass

    agent.include(protocol, publish_manifest=True)
    os.chdir(STATE)
    agent.run()


if __name__ == '__main__':
    main()
