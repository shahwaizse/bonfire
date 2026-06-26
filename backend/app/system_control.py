from __future__ import annotations

import json
import subprocess
import time

from app.config import BASE_DIR

ROOT_DIR = BASE_DIR.parent
SCRIPTS_DIR = ROOT_DIR / "scripts"
CREATE_NO_WINDOW = 0x08000000
CREATE_NEW_PROCESS_GROUP = 0x00000200
DETACHED_PROCESS = 0x00000008


def _powershell_script(script_name: str, *args: str, wait: bool = True) -> subprocess.CompletedProcess[str] | None:
    script_path = SCRIPTS_DIR / script_name
    command = [
        "powershell",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(script_path),
        *args,
    ]
    if wait:
        return subprocess.run(
            command,
            cwd=str(ROOT_DIR),
            text=True,
            capture_output=True,
            timeout=90,
            creationflags=CREATE_NO_WINDOW,
        )

    subprocess.Popen(
        command,
        cwd=str(ROOT_DIR),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS,
    )
    return None


def set_funnel_enabled(enabled: bool) -> None:
    result = _powershell_script("set-funnel.ps1", "-Enabled", str(enabled).lower())
    if result and result.returncode != 0:
        stderr = (result.stderr or result.stdout or "Unknown Tailscale error").strip()
        raise RuntimeError(stderr)

    deadline = time.monotonic() + 12
    while time.monotonic() < deadline:
        status = funnel_status()
        if enabled and status.get("active"):
            return
        if not enabled and not status.get("frontend") and not status.get("backend"):
            return
        time.sleep(0.75)

    status = funnel_status()
    if enabled and not status.get("active"):
        raise RuntimeError("Tailscale Funnel command completed, but Bonfire routes did not become active.")
    if not enabled and (status.get("frontend") or status.get("backend")):
        raise RuntimeError("Tailscale Funnel command completed, but Bonfire routes are still active.")


def funnel_status() -> dict:
    try:
        result = subprocess.run(
            ["tailscale", "funnel", "status", "--json"],
            cwd=str(ROOT_DIR),
            text=True,
            capture_output=True,
            timeout=10,
            creationflags=CREATE_NO_WINDOW,
        )
    except FileNotFoundError:
        return {"installed": False, "active": False, "frontend": False, "backend": False}
    except Exception as exc:
        return {"installed": True, "active": False, "frontend": False, "backend": False, "error": str(exc)}

    if result.returncode != 0:
        return {
            "installed": True,
            "active": False,
            "frontend": False,
            "backend": False,
            "error": (result.stderr or result.stdout).strip(),
        }

    try:
        data = json.loads(result.stdout or "{}")
    except json.JSONDecodeError:
        data = {}

    allow = data.get("AllowFunnel") or {}
    web = data.get("Web") or {}
    frontend = any(
        bool(allow.get(host)) and _has_proxy(handler, "http://127.0.0.1:3000")
        for host, handler in web.items()
    )
    backend = any(
        bool(allow.get(host)) and _has_proxy(handler, "http://127.0.0.1:8000")
        for host, handler in web.items()
    )
    return {"installed": True, "active": frontend and backend, "frontend": frontend, "backend": backend}


def schedule_shutdown() -> None:
    _powershell_script("shutdown-bonfire.ps1", wait=False)


def _has_proxy(handler: dict, proxy: str) -> bool:
    handlers = handler.get("Handlers") if isinstance(handler, dict) else None
    if not isinstance(handlers, dict):
        return False
    return any(isinstance(value, dict) and value.get("Proxy") == proxy for value in handlers.values())
