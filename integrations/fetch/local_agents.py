"""Offline uAgents identity bootstrap and typed three-role transport smoke test.

This is infrastructure only. It does not inspect or optimize application code.
Pinned to uagents 0.26.1; the local-only subclass overrides its unconditional
startup Almanac status update as well as registration.
"""
import argparse
import asyncio
import json
import os
from pathlib import Path
import secrets
import socket
from datetime import datetime, timezone
from importlib.metadata import version

from uagents import Agent, Context, Model
from uagents_core.registration import AgentRegistrationPolicy

ROOT = Path(__file__).resolve().parents[2]
STATE = Path(os.environ.get("FRAMESHIFT_DATA_DIR", str(ROOT / ".frameshift"))) / "fetch"
ROLES = ("investigator", "optimizer", "verifier")


class NoRegistration(AgentRegistrationPolicy):
    async def register(self, *args, **kwargs):
        return None


class LocalAgent(Agent):
    def start_registration_loop(self):
        return None

    async def _update_agent_status(self, active: bool):
        # uagents 0.26.1 calls this even with a no-op registration policy.
        return None


class Investigation(Model):
    run_id: str
    task: str


class Candidate(Model):
    run_id: str
    task: str
    changed_files: list[str]


class Verification(Model):
    run_id: str
    outcome: str
    optimization_performed: bool


def seeds():
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = STATE / "seeds.json"
    if not path.exists():
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as output:
            json.dump({role: secrets.token_hex(32) for role in ROLES}, output)
    os.chmod(path, 0o600)
    values = json.loads(path.read_text())
    if set(values) != set(ROLES) or any(len(values[r]) != 64 for r in ROLES):
        raise ValueError("Local identity file has an unexpected format; do not overwrite it.")
    return values


def agents():
    values = seeds()
    return {role: LocalAgent(
        name=f"earl-{role}", seed=values[role], network="testnet",
        registration_policy=NoRegistration(), endpoint=None, mailbox=False,
        publish_agent_details=False, mark_inactive_on_shutdown=False,
        report_events=False, enable_agent_inspector=False, log_level="WARNING",
    ) for role in ROLES}


async def smoke(roles):
    done = asyncio.Event()
    events = []
    run_id = secrets.token_hex(8)
    investigator, optimizer, verifier = (roles[r] for r in ROLES)

    @investigator.on_event("startup")
    async def start(ctx: Context):
        events.append({"from": "investigator", "to": "optimizer", "type": "Investigation"})
        await ctx.send(optimizer.address, Investigation(run_id=run_id, task="transport-smoke-only"))

    @optimizer.on_message(model=Investigation)
    async def optimize(ctx: Context, sender: str, message: Investigation):
        assert sender == investigator.address and message.run_id == run_id
        events.append({"from": "optimizer", "to": "verifier", "type": "Candidate"})
        await ctx.send(verifier.address, Candidate(run_id=run_id, task=message.task, changed_files=[]))

    @verifier.on_message(model=Candidate)
    async def verify(ctx: Context, sender: str, message: Candidate):
        assert sender == optimizer.address and message.run_id == run_id
        assert message.changed_files == [] and message.task == "transport-smoke-only"
        events.append({"from": "verifier", "to": "investigator", "type": "Verification"})
        await ctx.send(investigator.address, Verification(
            run_id=run_id, outcome="typed-local-handoff-passed", optimization_performed=False))

    @investigator.on_message(model=Verification)
    async def complete(ctx: Context, sender: str, message: Verification):
        assert sender == verifier.address and message.run_id == run_id
        assert message.outcome == "typed-local-handoff-passed" and not message.optimization_performed
        done.set()

    # Fail closed if this pinned SDK tries any network connection. Local dispatcher
    # delivery needs no sockets, server, Agentverse account, wallet funding or key.
    original_connect = socket.socket.connect
    def reject_network(*args, **kwargs):
        raise RuntimeError("Network disabled for local agent smoke test")
    socket.socket.connect = reject_network
    try:
        for agent in roles.values():
            agent.setup()
        await asyncio.wait_for(done.wait(), timeout=10)
    finally:
        await asyncio.gather(*(agent._shutdown([]) for agent in roles.values()))
        socket.socket.connect = original_connect
    return {"status": "passed", "mode": "local-in-process-uagents-dispatch",
            "utc": datetime.now(timezone.utc).isoformat(), "run_id": run_id,
            "network_connections_allowed": False, "model_calls": 0,
            "optimization_performed": False, "events": events}


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["identities", "smoke"])
    parser.add_argument("--evidence", type=Path)
    args = parser.parse_args()
    if args.evidence:
        args.evidence = args.evidence.resolve()
    os.chdir(STATE if STATE.exists() else ROOT)
    roles = agents()
    result = {"uagents": version("uagents"),
              "addresses": {name: agent.address for name, agent in roles.items()}}
    if args.command == "smoke":
        result.update(await smoke(roles))
    if args.evidence:
        args.evidence.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
