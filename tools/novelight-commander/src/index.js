import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createSecurityConfig, redactSecrets, resolveAllowedPath } from "./security.js";
import { appendAudit, readAudit } from "./audit.js";
import { buildThumbnailPack, compositePngLayers, scanThumbnailDirectory, validateThumbnailAsset } from "./assets.js";
import { createZip, extractZip, listZip, validateThumbnailPack } from "./archive.js";
import { appendBinaryChunk, beginBinaryWrite, cancelBinaryWrite, finishBinaryWrite, listBinaryWrites, readBinaryChunk } from "./binary-transfer.js";
import { copyFile, deletePath, fileInfo, hashFile, inspectPng, makeDirectory, moveFile, searchFiles } from "./files.js";
import { getNovelCache, listNovelCache, readNovelCached } from "./novel-cache.js";
import { readNovel } from "./novel.js";
import { registerOfficialThumbnailPack } from "./thumbnail-register.js";
import { listManagedProcesses, readManagedProcess, runOnce, startManagedProcess, stopManagedProcess } from "./processes.js";

const security = createSecurityConfig();
const server = new McpServer({ name: "novelight-commander", version: "0.5.0" });

function textResult(value) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

function auditArgs(args) {
  const clone = { ...(args || {}) };
  for (const key of ["content", "body", "password", "token", "secret"]) if (key in clone) clone[key] = "[OMITTED]";
  return clone;
}

function register(name, description, schema, handler) {
  server.tool(name, description, schema, async args => {
    try {
      const result = await handler(args || {});
      await appendAudit(security, name, { ok: true, args: auditArgs(args) });
      return textResult(result);
    } catch (error) {
      await appendAudit(security, name, { ok: false, args: auditArgs(args), error: error instanceof Error ? error.message : String(error) }).catch(() => {});
      throw error;
    }
  });
}

register("commander_info", "Show NOVELIGHT Commander roots, safety modes and executable allowlist.", {}, async () => ({
  version: "0.5.0",
  primaryRoot: security.primary,
  allowedRoots: security.roots,
  allowedCommands: [...security.commands],
  commandTimeoutMs: security.commandTimeoutMs,
  allowShell: security.allowShell,
  allowDestructive: security.allowDestructive,
  allowProduction: security.allowProduction,
  cacheDir: security.cacheDir,
  auditFile: security.auditFile
}));

register("list_files", "List files recursively inside an allowed directory.", {
  directory: z.string().default("."), depth: z.number().int().min(1).max(6).default(2)
}, async ({ directory, depth }) => {
  const root = resolveAllowedPath(directory, security);
  const rows = [];
  async function walk(current, currentDepth) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries.slice(0, 1000)) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const absolute = path.join(current, entry.name);
      rows.push({ path: path.relative(security.primary, absolute) || ".", type: entry.isDirectory() ? "directory" : "file" });
      if (entry.isDirectory() && currentDepth < depth) await walk(absolute, currentDepth + 1);
    }
  }
  await walk(root, 1);
  return rows;
});

register("file_info", "Get file or directory metadata.", { file: z.string() }, async ({ file }) => fileInfo(file, security));
register("search_files", "Search filenames and optionally text content inside allowed roots.", {
  directory: z.string().default("."), pattern: z.string().default("*"), content: z.string().optional(),
  caseSensitive: z.boolean().default(false), depth: z.number().int().min(1).max(12).default(6), maxResults: z.number().int().min(1).max(1000).default(200)
}, async ({ directory, ...options }) => searchFiles(directory, options, security));

register("read_text", "Read UTF-8 text with secret redaction.", { file: z.string(), maxChars: z.number().int().min(1).max(1000000).default(200000) }, async ({ file, maxChars }) => {
  const absolute = resolveAllowedPath(file, security);
  return redactSecrets((await fs.readFile(absolute, "utf8")).slice(0, maxChars));
});
register("read_text_range", "Read a character range from a UTF-8 text file.", { file:z.string(), offset:z.number().int().nonnegative().default(0), maxChars:z.number().int().min(1).max(1000000).default(100000) }, async a => {
  const absolute = resolveAllowedPath(a.file,security);
  const text = await fs.readFile(absolute,"utf8");
  return { totalChars:text.length, offset:a.offset, text:redactSecrets(text.slice(a.offset,a.offset+a.maxChars)) };
});
register("tail_text", "Read the tail of a UTF-8 text/log file.", { file:z.string(), maxChars:z.number().int().min(1).max(1000000).default(100000) }, async a => {
  const absolute = resolveAllowedPath(a.file,security);
  const text = await fs.readFile(absolute,"utf8");
  return redactSecrets(text.slice(-a.maxChars));
});

register("write_text", "Write UTF-8 text. Existing files require overwrite=true.", { file: z.string(), content: z.string(), overwrite: z.boolean().default(false) }, async ({ file, content, overwrite }) => {
  const absolute = resolveAllowedPath(file, security);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  if (!overwrite) {
    try { await fs.access(absolute); throw new Error("Target exists. Set overwrite=true explicitly."); }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
  await fs.writeFile(absolute, content, "utf8");
  return { written: absolute, chars: content.length };
});

register("copy_file", "Copy a file without overwriting the destination.", { source: z.string(), destination: z.string() }, async a => copyFile(a.source, a.destination, security));
register("move_file", "Move or rename a file inside allowed roots.", { source: z.string(), destination: z.string() }, async a => moveFile(a.source, a.destination, security));
register("create_directory", "Create a directory recursively.", { directory: z.string() }, async a => makeDirectory(a.directory, security));
register("delete_path", "Delete a file or directory. Disabled by default.", { path: z.string() }, async a => deletePath(a.path, security));
register("hash_file", "Hash a local file.", { file: z.string(), algorithm: z.enum(["sha256","sha512","md5"]).default("sha256") }, async a => hashFile(a.file, a.algorithm, security));
register("inspect_png", "Inspect PNG dimensions and actual alpha transparency.", { file: z.string() }, async a => inspectPng(a.file, security));
register("validate_thumbnail_asset", "Validate one NOVELIGHT thumbnail asset against category rules.", {
  file:z.string(), category:z.enum(["background","base_book","pattern","symbol","frame"])
}, async a => validateThumbnailAsset(a.file,a.category,security));
register("scan_thumbnail_directory", "Validate every PNG in a directory and detect exact SHA duplicates.", {
  directory:z.string(), category:z.enum(["background","base_book","pattern","symbol","frame"])
}, async a => scanThumbnailDirectory(a.directory,a.category,security));
register("build_thumbnail_pack", "Build an official thumbnail ZIP with manifest.json, manifest.csv and VALIDATION.json from approved PNGs.", {
  output:z.string(),
  packKey:z.string().min(1),
  displayName:z.string().optional(),
  templateKey:z.string().default("book-v1"),
  items:z.array(z.object({
    file:z.string(),
    key:z.string().min(1),
    label:z.string().min(1),
    category:z.enum(["background","base_book","pattern","symbol","frame"]),
    layerType:z.string().optional(),
    templateKey:z.string().optional(),
    sortOrder:z.number().int().optional()
  })).min(1).max(200)
}, async a => buildThumbnailPack(a.output,{packKey:a.packKey,displayName:a.displayName,templateKey:a.templateKey,items:a.items},security));
register("composite_png_layers", "Create a local validation preview by alpha-compositing same-size PNG layers without editing the sources.", {
  files:z.array(z.string()).min(2).max(12), output:z.string()
}, async a => compositePngLayers(a.files,a.output,security));

register("zip_list", "List ZIP entries and flag unsafe traversal paths.", { file: z.string() }, async a => listZip(a.file, security));
register("zip_extract", "Safely extract a ZIP inside allowed roots.", { file: z.string(), destination: z.string() }, async a => extractZip(a.file, a.destination, security));
register("zip_create", "Create a ZIP from selected files.", { output: z.string(), files: z.array(z.string()).min(1).max(500) }, async a => createZip(a.output, a.files, security));
register("validate_thumbnail_pack", "Validate an official thumbnail ZIP against its manifest including SHA-256 and PNG geometry.", { zip: z.string(), manifest: z.string().optional() }, async a => validateThumbnailPack(a.zip, a.manifest, security));
register("register_official_thumbnail_pack", "Production-gated official thumbnail ZIP registration to Supabase Storage and DB. Validates the entire pack before the first mutation and never deletes/replaces existing assets.", { zip:z.string(), manifest:z.string().optional(), confirmation:z.literal("REGISTER_OFFICIAL_THUMBNAIL_PACK") }, async a => registerOfficialThumbnailPack(a.zip,a.manifest,a.confirmation,security));

register("begin_binary_write", "Begin a chunked binary transfer into an allowed local path.", { file:z.string(), overwrite:z.boolean().default(false), expectedSize:z.number().int().nonnegative().optional(), expectedSha256:z.string().regex(/^[0-9a-fA-F]{64}$/).optional() }, async a => beginBinaryWrite(a.file,a,security));
register("append_binary_chunk", "Append one base64 chunk (max 2 MiB decoded) to a binary transfer.", { id:z.string().uuid(), index:z.number().int().nonnegative(), base64:z.string().min(1) }, async a => appendBinaryChunk(a.id,a.index,a.base64));
register("finish_binary_write", "Finish a binary transfer and verify optional size/SHA-256 before publishing the file.", { id:z.string().uuid() }, async a => finishBinaryWrite(a.id));
register("cancel_binary_write", "Cancel an unfinished binary transfer.", { id:z.string().uuid() }, async a => cancelBinaryWrite(a.id));
register("list_binary_writes", "List unfinished binary transfer sessions.", {}, async () => listBinaryWrites());
register("read_binary_chunk", "Read a local binary file as bounded base64 chunks.", { file:z.string(), offset:z.number().int().nonnegative().default(0), length:z.number().int().min(1).max(2097152).default(1048576) }, async a => readBinaryChunk(a.file,a.offset,a.length,security));

register("run_command", "Run an allowlisted executable under NOVELIGHT Commander safety policy.", {
  command: z.string(), args: z.array(z.string()).default([]), cwd: z.string().default("."), timeoutMs: z.number().int().min(1000).max(600000).optional()
}, async ({ command, args, cwd, timeoutMs }) => runOnce(command, args, resolveAllowedPath(cwd, security), security, timeoutMs));

register("start_process", "Start a long-running allowlisted process and return a session id.", { command: z.string(), args: z.array(z.string()).default([]), cwd: z.string().default(".") }, async a => startManagedProcess(a.command, a.args, resolveAllowedPath(a.cwd, security), security));
register("read_process_output", "Read output and status from a managed process.", { id: z.string().uuid(), offset: z.number().int().min(0).default(0), maxChars: z.number().int().min(1).max(500000).default(100000) }, async a => readManagedProcess(a.id, a.offset, a.maxChars));
register("list_processes", "List managed process sessions.", {}, async () => listManagedProcesses());
register("stop_process", "Stop a managed process.", { id: z.string().uuid() }, async a => stopManagedProcess(a.id));

async function git(args, cwd = ".") { return runOnce("git", args, resolveAllowedPath(cwd, security), security, security.commandTimeoutMs); }
register("git_status", "Show current branch and working tree status.", { cwd: z.string().default(".") }, async a => git(["status","--short","--branch"], a.cwd));
register("git_diff", "Show a bounded git diff.", { cwd: z.string().default("."), staged: z.boolean().default(false), maxChars: z.number().int().min(1000).max(500000).default(120000) }, async a => { const r = await git(["diff", ...(a.staged ? ["--cached"] : [])], a.cwd); return { ...r, stdout: r.stdout.slice(0, a.maxChars) }; });
register("git_fetch", "Fetch remotes and prune stale refs.", { cwd: z.string().default("."), remote: z.string().default("origin") }, async a => git(["fetch",a.remote,"--prune"], a.cwd));
register("git_latest_main", "Fetch origin/main and report local HEAD, origin/main and ahead/behind counts.", { cwd:z.string().default(".") }, async a => {
  await git(["fetch","origin","main","--prune"],a.cwd);
  const [head,main,counts] = await Promise.all([git(["rev-parse","HEAD"],a.cwd),git(["rev-parse","origin/main"],a.cwd),git(["rev-list","--left-right","--count","HEAD...origin/main"],a.cwd)]);
  const [ahead,behind] = counts.stdout.trim().split(/\s+/).map(Number);
  return { head:head.stdout.trim(), originMain:main.stdout.trim(), ahead, behind, upToDate:head.stdout.trim() === main.stdout.trim() };
});
register("git_worktree_list", "List git worktrees.", { cwd:z.string().default(".") }, async a => git(["worktree","list","--porcelain"],a.cwd));
register("git_worktree_add", "Create an isolated worktree on a new feature branch.", { cwd:z.string().default("."), directory:z.string(), branch:z.string().regex(/^[A-Za-z0-9._\/-]+$/), startPoint:z.string().default("origin/main") }, async a => {
  if (/^(main|master)$/i.test(a.branch)) throw new Error("Use a feature branch name.");
  const target = resolveAllowedPath(a.directory,security);
  return git(["worktree","add","-b",a.branch,target,a.startPoint],a.cwd);
});
register("git_pull_ff", "Fast-forward-only pull for the current branch.", { cwd: z.string().default(".") }, async a => git(["pull","--ff-only"], a.cwd));
register("git_create_branch", "Create and switch to a feature branch.", { cwd: z.string().default("."), branch: z.string().regex(/^[A-Za-z0-9._\/-]+$/) }, async a => { if (/^(main|master)$/i.test(a.branch)) throw new Error("Use a feature branch name."); return git(["checkout","-b",a.branch], a.cwd); });
register("git_commit", "Stage all changes and create a commit.", { cwd: z.string().default("."), message: z.string().min(1).max(240) }, async a => { const add = await git(["add","--all"],a.cwd); if (add.code !== 0) return { add }; const commit = await git(["commit","-m",a.message],a.cwd); return { add, commit }; });
register("git_push", "Push the current non-main branch. Main/master is blocked unless production mode is enabled.", { cwd: z.string().default("."), remote: z.string().default("origin"), setUpstream: z.boolean().default(true) }, async a => {
  const branchResult = await git(["rev-parse","--abbrev-ref","HEAD"],a.cwd);
  const branchName = branchResult.stdout.trim();
  if (/^(main|master)$/i.test(branchName) && !security.allowProduction) throw new Error("Push to main/master requires production mode.");
  return git(["push", ...(a.setUpstream ? ["-u"] : []), a.remote, branchName], a.cwd);
});

register("novelight_doctor", "Check local developer tooling required for NOVELIGHT Commander.", { cwd:z.string().default(".") }, async a => {
  const toolsToCheck = [["git",["--version"]],["npm",["--version"]],["gh",["--version"]],["supabase",["--version"]],["vercel",["--version"]]];
  const results = {};
  for (const [command,args] of toolsToCheck) {
    try { const r = await runOnce(command,args,resolveAllowedPath(a.cwd,security),security,15000); results[command] = { available:r.code === 0, version:(r.stdout || r.stderr).trim().split(/\r?\n/)[0] }; }
    catch (error) { results[command] = { available:false, error:error instanceof Error ? error.message : String(error) }; }
  }
  return { root:security.primary, productionMode:security.allowProduction, destructiveMode:security.allowDestructive, shellMode:security.allowShell, tools:results };
});

register("novelight_context_bundle", "Read the current NOVELIGHT MASTER and execution-gate documents from the local worktree in one call.", {
  cwd:z.string().default("."), maxCharsPerFile:z.number().int().min(1000).max(500000).default(120000)
}, async a => {
  const root = resolveAllowedPath(a.cwd,security);
  const files = [
    "docs/NOVELIGHT-MASTER.md",
    "docs/WORK-EXECUTION-PREFLIGHT.md",
    "docs/AUTOMATION-CONTINUATION-GATE.md",
    "docs/EXECUTION-TURN-CARD-GATE.md",
    "docs/EVIDENCE-FRESHNESS-GATE.md",
    "docs/development-workflow.md",
    "AGENTS.md"
  ];
  const documents = [];
  for (const relative of files) {
    const absolute = path.join(root,relative);
    try {
      const body = await fs.readFile(absolute,"utf8");
      documents.push({ path:relative, chars:body.length, content:redactSecrets(body.slice(0,a.maxCharsPerFile)) });
    } catch (error) {
      documents.push({ path:relative, error:error instanceof Error ? error.message : String(error) });
    }
  }
  return { root, documents };
});

register("novelight_handoff_report", "Generate a concise machine-readable handoff snapshot for the next chat or operator.", {
  cwd:z.string().default("."), pr:z.number().int().positive().optional()
}, async a => {
  const working = resolveAllowedPath(a.cwd,security);
  const [branch,head,status,main,log] = await Promise.all([
    runOnce("git",["rev-parse","--abbrev-ref","HEAD"],working,security,security.commandTimeoutMs),
    runOnce("git",["rev-parse","HEAD"],working,security,security.commandTimeoutMs),
    runOnce("git",["status","--short"],working,security,security.commandTimeoutMs),
    runOnce("git",["rev-parse","origin/main"],working,security,security.commandTimeoutMs),
    runOnce("git",["log","-8","--pretty=format:%H%x09%s"],working,security,security.commandTimeoutMs)
  ]);
  let pullRequest = null;
  if (a.pr) {
    pullRequest = await runOnce("gh",["pr","view",String(a.pr),"--json","number,title,state,isDraft,mergeable,headRefName,baseRefName,statusCheckRollup,url"],working,security,security.commandTimeoutMs);
  }
  return {
    generatedAt:new Date().toISOString(),
    branch:branch.stdout.trim(),
    head:head.stdout.trim(),
    originMain:main.stdout.trim(),
    clean:status.stdout.trim() === "",
    status:status.stdout,
    recentCommits:log.stdout,
    pullRequest
  };
});

register("novelight_repo_snapshot", "Collect branch, status, HEAD and recent commits for a NOVELIGHT worktree.", { cwd: z.string().default(".") }, async a => {
  const [branch,status,head,log] = await Promise.all([
    git(["rev-parse","--abbrev-ref","HEAD"],a.cwd), git(["status","--short"],a.cwd), git(["rev-parse","HEAD"],a.cwd), git(["log","-5","--pretty=format:%h %s"],a.cwd)
  ]);
  return { branch: branch.stdout.trim(), head: head.stdout.trim(), clean: status.stdout.trim() === "", status: status.stdout, recent: log.stdout };
});

register("novelight_prepare_workstream", "Create an isolated worktree from fresh origin/main for a new NOVELIGHT workstream.", { cwd:z.string().default("."), directory:z.string(), branch:z.string().regex(/^[A-Za-z0-9._\/-]+$/) }, async a => {
  if (/^(main|master)$/i.test(a.branch)) throw new Error("Use a feature branch name.");
  await git(["fetch","origin","main","--prune"],a.cwd);
  const target = resolveAllowedPath(a.directory,security);
  const result = await git(["worktree","add","-b",a.branch,target,"origin/main"],a.cwd);
  return { target, branch:a.branch, result };
});

register("novelight_commit_push", "Optionally run preflight:fast, commit all changes, and push the current feature branch.", { cwd:z.string().default("."), message:z.string().min(1).max(240), preflight:z.boolean().default(true) }, async a => {
  const working = resolveAllowedPath(a.cwd,security);
  const branchResult = await runOnce("git",["rev-parse","--abbrev-ref","HEAD"],working,security,security.commandTimeoutMs);
  const branchName = branchResult.stdout.trim();
  if (/^(main|master)$/i.test(branchName)) throw new Error("novelight_commit_push only accepts feature branches.");
  const result = {};
  if (a.preflight) {
    result.preflight = await runOnce("npm",["run","preflight:fast"],working,security,600000);
    if (result.preflight.code !== 0) return result;
  }
  result.add = await runOnce("git",["add","--all"],working,security,security.commandTimeoutMs);
  if (result.add.code !== 0) return result;
  result.commit = await runOnce("git",["commit","-m",a.message],working,security,security.commandTimeoutMs);
  if (result.commit.code !== 0) return result;
  result.push = await runOnce("git",["push","-u","origin",branchName],working,security,security.commandTimeoutMs);
  return result;
});

register("novelight_preflight", "Run the repository standard NOVELIGHT preflight profile.", { cwd: z.string().default("."), profile: z.enum(["fast","db","e2e","full","fix"]).default("fast") }, async a => {
  const script = "preflight:" + a.profile;
  return runOnce("npm",["run",script],resolveAllowedPath(a.cwd,security),security,600000);
});
register("gh_pr_checks", "Read GitHub PR checks through the installed gh CLI.", { cwd: z.string().default("."), pr: z.number().int().positive() }, async a => runOnce("gh",["pr","checks",String(a.pr)],resolveAllowedPath(a.cwd,security),security,security.commandTimeoutMs));
register("gh_pr_view", "Read PR metadata and status.", { cwd:z.string().default("."), pr:z.number().int().positive() }, async a => runOnce("gh",["pr","view",String(a.pr),"--json","number,title,state,isDraft,mergeable,headRefName,baseRefName,statusCheckRollup,url"],resolveAllowedPath(a.cwd,security),security,security.commandTimeoutMs));
register("gh_pr_create", "Create a pull request from the current feature branch.", { cwd:z.string().default("."), title:z.string().min(1).max(240), body:z.string().default(""), base:z.string().default("main") }, async a => runOnce("gh",["pr","create","--base",a.base,"--title",a.title,"--body",a.body],resolveAllowedPath(a.cwd,security),security,security.commandTimeoutMs));
register("gh_run_list", "List recent GitHub Actions runs.", { cwd: z.string().default("."), limit: z.number().int().min(1).max(50).default(10) }, async a => runOnce("gh",["run","list","--limit",String(a.limit)],resolveAllowedPath(a.cwd,security),security,security.commandTimeoutMs));
register("supabase_migration_list", "Read linked Supabase migration state.", { cwd: z.string().default(".") }, async a => runOnce("supabase",["migration","list"],resolveAllowedPath(a.cwd,security),security,security.commandTimeoutMs));
register("vercel_list", "List Vercel deployments through the installed CLI.", { cwd: z.string().default(".") }, async a => runOnce("vercel",["ls"],resolveAllowedPath(a.cwd,security),security,security.commandTimeoutMs));

register("read_novel", "Read every discoverable episode from a public novel URL and explicitly report completeness.", { url: z.string().url(), maxEpisodes: z.number().int().min(1).max(1000).optional() }, async a => readNovel(a.url,{ delayMs:Number(process.env.NOVELIGHT_COMMANDER_FETCH_DELAY_MS || 700), maxEpisodes:a.maxEpisodes || Number(process.env.NOVELIGHT_COMMANDER_MAX_EPISODES || 500) }));
register("read_novel_cached", "Read a novel while reusing already cached episodes and fetching new episodes only.", { url: z.string().url(), maxEpisodes: z.number().int().min(1).max(1000).optional(), refreshExisting: z.boolean().default(false) }, async a => readNovelCached(a.url,{ delayMs:Number(process.env.NOVELIGHT_COMMANDER_FETCH_DELAY_MS || 700), maxEpisodes:a.maxEpisodes || Number(process.env.NOVELIGHT_COMMANDER_MAX_EPISODES || 500), refreshExisting:a.refreshExisting },security));
register("get_novel_cache", "Read cached novel content for one URL without network access.", { url: z.string().url() }, async a => getNovelCache(a.url,security));
register("list_novel_cache", "List cached novels.", {}, async () => listNovelCache(security));
register("read_audit", "Read recent NOVELIGHT Commander audit records.", { limit: z.number().int().min(1).max(1000).default(100) }, async a => readAudit(security,a.limit));

await server.connect(new StdioServerTransport());
