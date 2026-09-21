import path from "node:path";

function flag(value) {
  return /^(1|true|yes|on)$/i.test(String(value || ""));
}

export function createSecurityConfig(env = process.env) {
  const primary = path.resolve(env.NOVELIGHT_COMMANDER_ROOT || process.cwd());
  const extras = String(env.NOVELIGHT_COMMANDER_EXTRA_ROOTS || "").split(",").map(v => v.trim()).filter(Boolean).map(v => path.resolve(v));
  const commands = new Set(String(env.NOVELIGHT_COMMANDER_COMMANDS || "git,npm,gh,supabase,vercel").split(",").map(v => v.trim().toLowerCase()).filter(Boolean));
  const commandTimeoutMs = Math.max(1000, Math.min(600000, Number(env.NOVELIGHT_COMMANDER_COMMAND_TIMEOUT_MS || 120000)));
  return {
    primary,
    roots: [primary, ...extras],
    commands,
    commandTimeoutMs,
    allowShell: flag(env.NOVELIGHT_COMMANDER_ALLOW_SHELL),
    allowDestructive: flag(env.NOVELIGHT_COMMANDER_ALLOW_DESTRUCTIVE),
    allowProduction: flag(env.NOVELIGHT_COMMANDER_ALLOW_PRODUCTION),
    auditFile: env.NOVELIGHT_COMMANDER_AUDIT_FILE || ".novelight-commander/audit.jsonl",
    cacheDir: env.NOVELIGHT_COMMANDER_CACHE_DIR || ".novelight-commander/cache"
  };
}

export function resolveAllowedPath(inputPath, config) {
  const absolute = path.resolve(config.primary, String(inputPath || "."));
  const allowed = config.roots.some(root => {
    const relative = path.relative(root, absolute);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
  if (!allowed) throw new Error("Path is outside NOVELIGHT Commander allowed roots.");
  return absolute;
}

export function assertAllowedCommand(command, config) {
  const executable = String(command || "").trim().split(/\s+/)[0].replace(/\.exe$/i, "").toLowerCase();
  if (!executable || !config.commands.has(executable)) throw new Error("Command is not allowlisted: " + (executable || "(empty)"));
  const shellNames = new Set(["powershell","pwsh","cmd","bash","sh","zsh","node","npx"]);
  if (shellNames.has(executable) && !config.allowShell) throw new Error("General shell execution is disabled by policy.");
  return executable;
}

export function assertSafeInvocation(command, args, config) {
  const executable = assertAllowedCommand(command, config);
  const values = (args || []).map(v => String(v));
  const joined = values.join(" ").toLowerCase();
  if (!config.allowShell && executable === "npm" && ["exec","x","dlx"].includes(String(values[0] || "").toLowerCase())) throw new Error("npm arbitrary execution is disabled by policy.");
  if (!config.allowDestructive) {
    if (executable === "git" && (/\breset\s+--hard\b/.test(joined) || /\bclean\s+-[^ ]*f/.test(joined) || /\bbranch\s+-d\b/i.test(joined) || /\bpush\b.*--force/.test(joined))) {
      throw new Error("Destructive git operation is disabled by policy.");
    }
  }
  if (!config.allowProduction) {
    if (executable === "git" && values[0] === "push" && values.some(v => /(^|:)main$|(^|:)master$/i.test(v))) throw new Error("Push to main/master requires production mode.");
    if (executable === "gh" && values[0] === "pr" && values[1] === "merge") throw new Error("PR merge requires production mode.");
    if (executable === "gh" && values[0] === "api" && values.some(v => /^--method=(post|put|patch|delete)$/i.test(v) || /^-(X|x)$/.test(v))) throw new Error("GitHub API mutation requires production mode.");
    if (executable === "supabase" && ((values[0] === "db" && values[1] === "push") || (values[0] === "migration" && values[1] === "up") || (values[0] === "functions" && values[1] === "deploy") || values[0] === "secrets")) throw new Error("Supabase mutation requires production mode.");
    if (executable === "vercel" && values.some(v => v === "--prod" || v === "--production")) throw new Error("Vercel production deploy requires production mode.");
    if (executable === "npm" && values[0] === "run" && /(?:^|:)(deploy|production|prod)(?:$|:)/i.test(String(values[1] || ""))) throw new Error("Production-like npm script requires production mode.");
  }
  return executable;
}

export function redactSecrets(text) {
  return String(text || "")
    .replace(/(SUPABASE_(?:SECRET|SERVICE_ROLE)_KEY\s*[=:]\s*)[^\s"']+/gi, "$1[REDACTED]")
    .replace(/(STRIPE_[A-Z0-9_]*SECRET[A-Z0-9_]*\s*[=:]\s*)[^\s"']+/gi, "$1[REDACTED]")
    .replace(/((?:TOKEN|API_KEY|SECRET|PASSWORD)\s*[=:]\s*)[^\s"']+/gi, "$1[REDACTED]")
    .replace(/(authorization:\s*bearer\s+)[A-Za-z0-9._~+\/-]+/gi, "$1[REDACTED]");
}
