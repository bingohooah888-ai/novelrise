import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { assertSafeInvocation, redactSecrets } from "./security.js";

const sessions = new Map();

function clampBuffer(text) {
  return text.length > 1000000 ? text.slice(-1000000) : text;
}

export function startManagedProcess(command, args, cwd, config) {
  const executable = assertSafeInvocation(command, args, config);
  const id = crypto.randomUUID();
  const child = spawn(executable, args, { cwd, shell: false, windowsHide: true, env: process.env });
  const session = {
    id, command: executable, args, cwd, pid: child.pid, status: "running", code: null, signal: null,
    startedAt: new Date().toISOString(), endedAt: null, stdout: "", stderr: "", child
  };
  sessions.set(id, session);
  child.stdout?.on("data", chunk => { session.stdout = clampBuffer(session.stdout + chunk.toString()); });
  child.stderr?.on("data", chunk => { session.stderr = clampBuffer(session.stderr + chunk.toString()); });
  child.on("error", error => { session.status = "failed"; session.stderr = clampBuffer(session.stderr + "\n" + error.message); session.endedAt = new Date().toISOString(); });
  child.on("close", (code, signal) => { session.status = code === 0 ? "completed" : "failed"; session.code = code; session.signal = signal; session.endedAt = new Date().toISOString(); });
  return publicSession(session);
}

export function publicSession(session) {
  return {
    id: session.id, command: session.command, args: session.args, cwd: session.cwd, pid: session.pid,
    status: session.status, code: session.code, signal: session.signal, startedAt: session.startedAt, endedAt: session.endedAt
  };
}

export function listManagedProcesses() {
  return [...sessions.values()].map(publicSession);
}

export function readManagedProcess(id, offset = 0, maxChars = 100000) {
  const session = sessions.get(id);
  if (!session) throw new Error("Unknown process session.");
  const start = Math.max(0, Number(offset) || 0);
  const max = Math.max(1, Math.min(500000, Number(maxChars) || 100000));
  return {
    ...publicSession(session),
    stdout: redactSecrets(session.stdout.slice(start, start + max)),
    stderr: redactSecrets(session.stderr.slice(start, start + max)),
    stdoutLength: session.stdout.length, stderrLength: session.stderr.length
  };
}

export function stopManagedProcess(id) {
  const session = sessions.get(id);
  if (!session) throw new Error("Unknown process session.");
  if (session.status === "running") session.child.kill();
  return publicSession(session);
}

export async function runOnce(command, args, cwd, config, timeoutMs) {
  const executable = assertSafeInvocation(command, args, config);
  const limit = timeoutMs || config.commandTimeoutMs;
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, shell: false, windowsHide: true, env: process.env });
    let stdout = ""; let stderr = ""; let settled = false;
    const timer = setTimeout(() => { child.kill(); if (!settled) { settled = true; reject(new Error("Command timed out after " + limit + "ms.")); } }, limit);
    child.stdout?.on("data", chunk => { stdout = clampBuffer(stdout + chunk.toString()); });
    child.stderr?.on("data", chunk => { stderr = clampBuffer(stderr + chunk.toString()); });
    child.on("error", error => { clearTimeout(timer); if (!settled) { settled = true; reject(error); } });
    child.on("close", code => { clearTimeout(timer); if (!settled) { settled = true; resolve({ code, stdout: redactSecrets(stdout), stderr: redactSecrets(stderr) }); } });
  });
}
