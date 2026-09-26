import os from 'node:os';
import { spawn } from 'node:child_process';

export const CODEX_AUTH_REPAIR_CONFIRMATION = 'CLEAR_USER_OPENAI_API_KEY_OVERRIDE';

const ENV_NAMES = [
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_FEDERATION_RULE_ID',
  'OPENAI_IDENTITY_TOKEN_FILE'
];

function run(executable, args, options = {}) {
  const timeoutMs = options.timeoutMs || 60000;
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd || process.cwd(),
      shell: false,
      windowsHide: true,
      env: options.env || process.env
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      if (!settled) {
        settled = true;
        reject(new Error('Process timed out after ' + timeoutMs + 'ms.'));
      }
    }, timeoutMs);
    child.stdout?.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', error => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve({ code, stdout, stderr });
      }
    });
  });
}

function runCodex(args, options = {}) {
  if (os.platform() === 'win32') {
    return run(
      process.env.ComSpec || 'cmd.exe',
      ['/d', '/s', '/c', 'codex', ...args],
      options
    );
  }
  return run('codex', args, options);
}

function runPowerShell(command, options = {}) {
  if (os.platform() !== 'win32') {
    throw new Error('Windows environment scope inspection is Windows-only.');
  }
  return run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', command],
    options
  );
}

export function redactCodexDiagnosticText(text, limit = 1600) {
  const value = String(text || '')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[REDACTED_OPENAI_KEY]')
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}/g, '[REDACTED_SECRET]')
    .replace(
      /((?:OPENAI_API_KEY|API_KEY|TOKEN|SECRET|PASSWORD)\s*[=:]\s*)[^\s\"'\r\n]+/gi,
      '$1[REDACTED]'
    )
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]')
    .replace(/\r/g, '')
    .trim();
  return value.length > limit ? value.slice(0, limit) + '\n[truncated]' : value;
}

export function classifyCodexLogin(text) {
  const value = String(text || '').toLowerCase();
  if (value.includes('workload identity')) return 'workload_identity';
  if (value.includes('chatgpt')) return 'chatgpt';
  if (value.includes('api key') || value.includes('api_key')) return 'api_key';
  if (value.includes('not logged in') || value.includes('logged out')) return 'not_logged_in';
  return 'unknown';
}

async function scopedPresence(variableName, scope) {
  if (!ENV_NAMES.includes(variableName)) {
    throw new Error('Unsupported Codex environment variable.');
  }
  if (!['User', 'Machine'].includes(scope)) {
    throw new Error('Unsupported Windows environment scope.');
  }
  const command =
    "$v=[Environment]::GetEnvironmentVariable('" +
    variableName +
    "','" +
    scope +
    "'); if([string]::IsNullOrWhiteSpace($v)){'false'}else{'true'}";
  const result = await runPowerShell(command, { timeoutMs: 15000 });
  if (result.code !== 0) {
    throw new Error(
      'Could not inspect ' + variableName + ' at ' + scope + ' scope.'
    );
  }
  return result.stdout.trim().toLowerCase() === 'true';
}

async function collectEnvironmentPresence() {
  const rows = {};
  for (const name of ENV_NAMES) {
    rows[name] = {
      process: Boolean(String(process.env[name] || '').trim()),
      user: await scopedPresence(name, 'User'),
      machine: await scopedPresence(name, 'Machine')
    };
  }
  return rows;
}

function has401Evidence(text) {
  const value = String(text || '').toLowerCase();
  return (
    value.includes('401') ||
    value.includes('incorrect api key') ||
    value.includes('invalid api key') ||
    value.includes('unauthorized')
  );
}

function safeCommandSummary(result) {
  return redactCodexDiagnosticText(
    [result.stdout, result.stderr].filter(Boolean).join('\n'),
    1600
  );
}

export async function diagnoseCodexAuth(options = {}) {
  if (os.platform() !== 'win32') {
    throw new Error('Codex auth diagnostics are currently Windows-only.');
  }

  const cwd = options.cwd || process.cwd();
  const presence = await collectEnvironmentPresence();

  const login = await runCodex(['login', 'status'], {
    cwd,
    timeoutMs: 60000
  }).catch(error => ({
    code: -1,
    stdout: '',
    stderr: error instanceof Error ? error.message : String(error)
  }));

  const doctor = await runCodex(['doctor'], {
    cwd,
    timeoutMs: 120000
  }).catch(error => ({
    code: -1,
    stdout: '',
    stderr: error instanceof Error ? error.message : String(error)
  }));

  const loginText = safeCommandSummary(login);
  const doctorText = safeCommandSummary(doctor);
  const loginMethod = classifyCodexLogin(loginText);
  const apiKeyPresence = presence.OPENAI_API_KEY;
  const apiKeyOverridePresent =
    apiKeyPresence.process || apiKeyPresence.user || apiKeyPresence.machine;
  const unauthorizedEvidence = has401Evidence(loginText + '\n' + doctorText);

  let recommendedAction = 'none';
  if (apiKeyPresence.machine) {
    recommendedAction = 'machine_scope_review_required';
  } else if (apiKeyPresence.user && unauthorizedEvidence) {
    recommendedAction = 'clear_user_openai_api_key_override';
  } else if (apiKeyOverridePresent && loginMethod === 'chatgpt') {
    recommendedAction = 'review_api_key_override';
  } else if (loginMethod === 'not_logged_in') {
    recommendedAction = 'chatgpt_login_required';
  }

  return {
    platform: os.platform(),
    codexLoginExit: login.code,
    codexLoginMethod: loginMethod,
    codexLoginStatus: loginText || '(no output)',
    codexDoctorExit: doctor.code,
    codexDoctorStatus: doctorText || '(no output)',
    unauthorizedEvidence,
    environmentPresence: presence,
    apiKeyOverridePresent,
    recommendedAction,
    secretValuesExposed: false
  };
}

export async function clearUserOpenAiApiKeyOverride(options = {}) {
  if (os.platform() !== 'win32') {
    throw new Error('Codex auth repair is currently Windows-only.');
  }
  if (options.confirmation !== CODEX_AUTH_REPAIR_CONFIRMATION) {
    throw new Error('Codex auth repair confirmation mismatch.');
  }

  const machinePresent = await scopedPresence('OPENAI_API_KEY', 'Machine');
  if (machinePresent) {
    throw new Error(
      'Machine-scope OPENAI_API_KEY is present; automatic repair is blocked.'
    );
  }

  const before = await scopedPresence('OPENAI_API_KEY', 'User');
  if (before) {
    const command =
      "[Environment]::SetEnvironmentVariable('OPENAI_API_KEY',$null,'User')";
    const result = await runPowerShell(command, { timeoutMs: 15000 });
    if (result.code !== 0) {
      throw new Error('Could not clear User-scope OPENAI_API_KEY.');
    }
  }

  delete process.env.OPENAI_API_KEY;
  const after = await scopedPresence('OPENAI_API_KEY', 'User');
  if (after) {
    throw new Error('User-scope OPENAI_API_KEY remained after repair.');
  }

  return {
    userScopePresentBefore: before,
    userScopePresentAfter: after,
    processScopeCleared: true,
    machineScopePresent: false,
    codexRestartRequired: true,
    secretValuesExposed: false
  };
}
