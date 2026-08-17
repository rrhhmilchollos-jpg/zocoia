from __future__ import annotations

import asyncio
import hmac
import os
import re
import secrets
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

import docker
from docker.errors import APIError, NotFound
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

SERVICE_TOKEN = os.environ.get("SANDBOX_RUNNER_TOKEN", "")
SANDBOX_IMAGE = os.environ.get("SANDBOX_IMAGE", "python:3.11-slim")
SANDBOX_NETWORK = os.environ.get("SANDBOX_NETWORK", "zocoia_sandbox_isolated")
HOST_WORKSPACE_ROOT = os.environ.get("SANDBOX_HOST_WORKSPACE_ROOT", "")
MAX_SESSIONS = int(os.environ.get("SANDBOX_MAX_SESSIONS", "4"))
MAX_COMMANDS_PER_SESSION = int(os.environ.get("SANDBOX_MAX_COMMANDS", "40"))
SESSION_TTL_SECONDS = int(os.environ.get("SANDBOX_TTL_SECONDS", "900"))
MAX_OUTPUT_BYTES = int(os.environ.get("SANDBOX_MAX_OUTPUT_BYTES", "65536"))

# Prohibits host escape primitives, network tooling and package installation in the initial release.
DENIED_COMMAND = re.compile(
    r"(?:^|\s)(?:docker|mount|umount|nsenter|unshare|iptables|nft|curl|wget|nc|ncat|ssh|scp|apt|apt-get|pip|pip3)(?:\s|$)|"
    r"(?:/proc|/sys|/dev/(?:sda|vda|kvm)|--privileged|host\.docker\.internal)",
    re.IGNORECASE,
)

client = docker.from_env()


@dataclass
class SandboxSession:
    container_id: str
    created_at: float
    commands_run: int = 0


sessions: dict[str, SandboxSession] = {}
lock = asyncio.Lock()


class StartRequest(BaseModel):
    task_id: str = Field(min_length=6, max_length=96, pattern=r"^[A-Za-z0-9_-]+$")


class ExecuteRequest(BaseModel):
    command: str = Field(min_length=1, max_length=4096)
    timeout_seconds: int = Field(default=30, ge=1, le=60)


def require_service_token(value: str | None) -> None:
    if not SERVICE_TOKEN or not value or not hmac.compare_digest(value, SERVICE_TOKEN):
        raise HTTPException(status_code=401, detail="Servicio no autorizado")


def session_name(task_id: str) -> str:
    return f"zoco-sbx-{task_id[:48]}-{secrets.token_hex(4)}"


def command_allowed(command: str) -> bool:
    return not bool(DENIED_COMMAND.search(command))


def clean_output(value: bytes | None) -> str:
    text = (value or b"").decode("utf-8", errors="replace")
    if len(text.encode("utf-8")) <= MAX_OUTPUT_BYTES:
        return text
    return text.encode("utf-8")[:MAX_OUTPUT_BYTES].decode("utf-8", errors="ignore") + "\n[Salida truncada por política]"


def create_network() -> None:
    try:
        client.networks.get(SANDBOX_NETWORK)
    except NotFound:
        client.networks.create(SANDBOX_NETWORK, driver="bridge", internal=True, attachable=False)


def workspace_for(task_id: str) -> str:
    if not HOST_WORKSPACE_ROOT:
        raise RuntimeError("SANDBOX_HOST_WORKSPACE_ROOT es obligatorio")
    # Esta ruta pertenece al host Docker y no se monta dentro del runner. Se
    # comprueba de forma léxica; task_id ya está limitado por el modelo Pydantic.
    root = os.path.normpath(HOST_WORKSPACE_ROOT)
    candidate = os.path.normpath(os.path.join(root, task_id))
    if os.path.commonpath([root, candidate]) != root:
        raise RuntimeError("Workspace de tarea no permitido")
    return candidate


def start_container(task_id: str):
    create_network()
    workspace = workspace_for(task_id)
    return client.containers.run(
        SANDBOX_IMAGE,
        name=session_name(task_id),
        command=["sh", "-c", "trap 'exit 0' TERM INT; while :; do sleep 60; done"],
        detach=True,
        auto_remove=True,
        tty=False,
        stdin_open=False,
        network=SANDBOX_NETWORK,
        mem_limit="512m",
        memswap_limit="512m",
        nano_cpus=1_000_000_000,
        pids_limit=128,
        read_only=True,
        tmpfs={"/tmp": "rw,noexec,nosuid,size=64m"},
        volumes={workspace: {"bind": "/work", "mode": "rw"}},
        working_dir="/work",
        user="10001:10001",
        cap_drop=["ALL"],
        security_opt=["no-new-privileges:true"],
        labels={"zocoia.sandbox": "true", "zocoia.task": task_id},
        environment={"HOME": "/work", "PATH": "/usr/local/bin:/usr/bin:/bin", "PYTHONDONTWRITEBYTECODE": "1"},
    )


async def cleanup_expired() -> None:
    now = time.time()
    stale = [sid for sid, record in sessions.items() if now - record.created_at > SESSION_TTL_SECONDS]
    for sid in stale:
        record = sessions.pop(sid, None)
        if not record:
            continue
        try:
            client.containers.get(record.container_id).stop(timeout=1)
        except (NotFound, APIError):
            pass


async def reaper() -> None:
    while True:
        async with lock:
            await cleanup_expired()
        await asyncio.sleep(30)


@asynccontextmanager
async def lifespan(_: FastAPI):
    if not SERVICE_TOKEN:
        raise RuntimeError("SANDBOX_RUNNER_TOKEN es obligatorio")
    create_network()
    task = asyncio.create_task(reaper())
    try:
        yield
    finally:
        task.cancel()
        async with lock:
            for record in list(sessions.values()):
                try:
                    client.containers.get(record.container_id).stop(timeout=1)
                except (NotFound, APIError):
                    pass
            sessions.clear()


app = FastAPI(title="Zoco sandbox runner", docs_url=None, redoc_url=None, lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "sessions": len(sessions), "network": "isolated"}


@app.post("/v1/sessions")
async def start_session(payload: StartRequest, x_sandbox_runner_token: str | None = Header(default=None)) -> dict[str, Any]:
    require_service_token(x_sandbox_runner_token)
    async with lock:
        await cleanup_expired()
        if len(sessions) >= MAX_SESSIONS:
            raise HTTPException(status_code=429, detail="Capacidad de sandbox temporal agotada")
        container = start_container(payload.task_id)
        session_id = secrets.token_urlsafe(24)
        sessions[session_id] = SandboxSession(container_id=container.id, created_at=time.time())
        return {"session_id": session_id, "expires_in_seconds": SESSION_TTL_SECONDS, "network": "isolated"}


@app.post("/v1/sessions/{session_id}/exec")
async def execute(session_id: str, payload: ExecuteRequest, x_sandbox_runner_token: str | None = Header(default=None)) -> dict[str, Any]:
    require_service_token(x_sandbox_runner_token)
    if not command_allowed(payload.command):
        raise HTTPException(status_code=400, detail="Comando bloqueado por política de sandbox")
    async with lock:
        await cleanup_expired()
        session = sessions.get(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Sesión inexistente o caducada")
        if session.commands_run >= MAX_COMMANDS_PER_SESSION:
            raise HTTPException(status_code=429, detail="Límite de comandos por sesión alcanzado")
        try:
            container = client.containers.get(session.container_id)
            result = container.exec_run(["sh", "-lc", f"timeout {payload.timeout_seconds}s {payload.command}"], demux=True)
        except (NotFound, APIError) as exc:
            sessions.pop(session_id, None)
            raise HTTPException(status_code=410, detail="Sandbox no disponible") from exc
        session.commands_run += 1
        stdout, stderr = result.output if isinstance(result.output, tuple) else (result.output, b"")
        return {
            "exit_code": result.exit_code,
            "stdout": clean_output(stdout),
            "stderr": clean_output(stderr),
            "commands_remaining": MAX_COMMANDS_PER_SESSION - session.commands_run,
        }


@app.delete("/v1/sessions/{session_id}")
async def close_session(session_id: str, x_sandbox_runner_token: str | None = Header(default=None)) -> dict[str, bool]:
    require_service_token(x_sandbox_runner_token)
    async with lock:
        session = sessions.pop(session_id, None)
        if not session:
            return {"closed": False}
        try:
            client.containers.get(session.container_id).stop(timeout=1)
        except (NotFound, APIError):
            pass
        return {"closed": True}
