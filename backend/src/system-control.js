import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { ROOT_DIR } from "./config.js";

const SCRIPTS_DIR = path.join(ROOT_DIR, "scripts");

function runPowerShell(scriptName, args = [], { wait = true } = {}) {
  const scriptPath = path.join(SCRIPTS_DIR, scriptName);
  const command = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args];
  if (!wait) {
    const child = spawn("powershell", command, {
      cwd: ROOT_DIR,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return null;
  }

  return spawnSync("powershell", command, {
    cwd: ROOT_DIR,
    encoding: "utf8",
    timeout: 90_000,
    windowsHide: true,
  });
}

export function setFunnelEnabled(enabled) {
  const result = runPowerShell("set-funnel.ps1", ["-Enabled", String(Boolean(enabled)).toLowerCase()]);
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "Unknown Tailscale error").trim());
  }
}

export function funnelStatus() {
  const result = spawnSync("tailscale", ["funnel", "status", "--json"], {
    cwd: ROOT_DIR,
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
  if (result.error?.code === "ENOENT") {
    return { installed: false, active: false, frontend: false, backend: false };
  }
  if (result.error) {
    return { installed: true, active: false, frontend: false, backend: false, error: result.error.message };
  }
  if (result.status !== 0) {
    return {
      installed: true,
      active: false,
      frontend: false,
      backend: false,
      error: (result.stderr || result.stdout || "").trim(),
    };
  }

  let data = {};
  try {
    data = JSON.parse(result.stdout || "{}");
  } catch {
    data = {};
  }

  const allow = data.AllowFunnel || {};
  const web = data.Web || {};
  const frontend = Object.entries(web).some(([host, handler]) => allow[host] && hasProxy(handler, "http://127.0.0.1:3000"));
  const backend = Object.entries(web).some(([host, handler]) => allow[host] && hasProxy(handler, "http://127.0.0.1:8000"));
  return { installed: true, active: frontend && backend, frontend, backend };
}

export function scheduleShutdown() {
  runPowerShell("shutdown-bonfire.ps1", [], { wait: false });
}

function hasProxy(handler, proxy) {
  const handlers = handler?.Handlers;
  return Boolean(
    handlers &&
      Object.values(handlers).some((value) => value && typeof value === "object" && value.Proxy === proxy)
  );
}
