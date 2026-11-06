// NOVELIGHT Point10x: opt-in, disposable, LOCAL-ONLY PostgreSQL proof harness.
// Default is read-only --probe. --run is allowed ONLY when an independently
// downloaded image already exists, Docker Engine is available, and the
// operator explicitly sets NOVELIGHT_POINT10X_LOCAL_PG=I_ACCEPT_DISPOSABLE_DB.
// No Supabase projects/URLs, app credentials, docker volumes, host ports or
// outbound container network. NEVER use this for Staging or Production.
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import {
  LOCAL_DOCKER_CONTEXT,
  BLOCKED_DOCKER_ENV_KEYS,
  inspectDisposableDockerSafety
} from './scout-point10x-docker-inventory-policy.mjs';

export const DISPOSABLE_POSTGRES_IMAGE = 'postgres:16-alpine';
export const OPT_IN_NAME = 'NOVELIGHT_POINT10X_LOCAL_PG';
export const OPT_IN_VALUE = 'I_ACCEPT_DISPOSABLE_DB';
export const SANDBOX_LABEL = 'novelight.point10x.disposable';
export const CONTROL_DATABASE = 'nl_point10x_control';
export const STAGE_DATABASE = 'nl_point10x_stage';
export const PROOF_SCENARIOS = Object.freeze([
  'control_serializable_claim_race_exactly_one_winner',
  'control_spent_comment_and_operation_not_reusable',
  'control_epoch_increased_exactly_once',
  'discarded_ack_then_primary_readback_no_second_claim',
  'stage_fake_service_role_bypassrls_insert_before_freeze',
  'stage_fake_service_role_direct_insert_denied_after_freeze',
  'stage_fake_service_role_update_denied_after_freeze',
  'stage_fake_service_role_delete_denied_after_freeze',
  'stage_fake_service_role_truncate_denied_after_freeze',
  'stage_legacy_security_definer_award_denied_after_freeze',
  'fake_service_role_cannot_disable_triggers',
  'stage_fence_epoch_matches_primary_and_remains_closed',
  'superuser_can_disable_user_triggers_expected_gap',
  'stage_fence_and_one_legitimate_pre_freeze_award_preserved'
]);
const asText = (x) => (typeof x === 'string' ? x : '');
export function checkLocalProofPermission(env, args) {
  const blockers = [];
  if (!Array.isArray(args) || args.length !== 1 || args[0] !== '--run')
    blockers.push('exact_run_flag_required');
  if (env?.[OPT_IN_NAME] !== OPT_IN_VALUE)
    blockers.push('explicit_local_only_opt_in_missing');
  for (const key of [
    'DATABASE_URL',
    'SUPABASE_DB_URL',
    'SUPABASE_URL',
    'POSTGRES_URL',
    'PGHOST',
    'PGSERVICE',
    'PGPORT'
  ]) {
    if (typeof env?.[key] === 'string' && env[key].trim())
      blockers.push('external_database_environment_present:' + key);
  }
  for (const key of BLOCKED_DOCKER_ENV_KEYS) {
    if (typeof env?.[key] === 'string' && env[key].trim())
      blockers.push('docker_endpoint_override_detected:' + key);
  }
  return Object.freeze({
    readyForLocalProbe: blockers.length === 0,
    blockers: Object.freeze(blockers),
    mayContactSupabase: false,
    mayUseExistingPgHost: false,
    mayRunProduction: false
  });
}
export function disposableDockerArguments(nonce) {
  if (typeof nonce !== 'string' || !/^[a-f0-9]{12}$/u.test(nonce))
    throw new Error('invalid_generated_nonce');
  const name = 'nl-point10x-pg-proof-' + nonce;
  const args = [
    'run',
    '--detach',
    '--rm',
    '--pull=never',
    '--network=none',
    '--publish-all=false',
    '--name',
    name,
    '--label',
    SANDBOX_LABEL + '=' + nonce,
    '--memory=512m',
    '--pids-limit=128',
    '--tmpfs',
    '/var/lib/postgresql/data:rw,size=256m',
    '--tmpfs',
    '/var/run/postgresql:rw,size=16m',
    '-e',
    'POSTGRES_HOST_AUTH_METHOD=trust',
    '-e',
    'PGDATA=/var/lib/postgresql/data/pgdata',
    DISPOSABLE_POSTGRES_IMAGE
  ];
  return Object.freeze({
    name,
    nonce,
    args: Object.freeze(args),
    noDockerVolumes: true,
    noPublishedPorts: true,
    noNetwork: true,
    noImagePull: true,
    onlySyntheticTestCredentials: true
  });
}
function docker(args, options = {}) {
  const result = spawnSync(
    'docker',
    ['--context', LOCAL_DOCKER_CONTEXT, ...args],
    {
      encoding: 'utf8',
      input: options.input,
      timeout: options.timeout || 15000,
      windowsHide: true,
      maxBuffer: 1024 * 512
    }
  );
  return {
    ok: !result.error && result.status === 0,
    status: result.status,
    stdout: asText(result.stdout).trim(),
    stderr: asText(result.stderr).trim(),
    errorCode: result.error?.code || null
  };
}
export function checkDisposablePostgresAvailability(env = process.env) {
  // Check environment *before* any Docker daemon query. Docker CLI can point
  // to a remote host through inherited variables or context configuration.
  const endpointOverride = BLOCKED_DOCKER_ENV_KEYS.some(
    (key) => typeof env?.[key] === 'string' && env[key].trim()
  );
  if (endpointOverride) {
    const guard = inspectDisposableDockerSafety({ environment: env });
    return Object.freeze({
      available: false,
      dockerClientInstalled: false,
      linuxEngineAvailable: false,
      imageAlreadyCached: false,
      ...guard,
      willPullImage: false,
      willConnectExistingDatabase: false,
      willStartContainers: false,
      willChangeDockerDesktopSettings: false
    });
  }
  const cli = docker(['--version']);
  const ctx = cli.ok
    ? docker(['context', 'inspect', LOCAL_DOCKER_CONTEXT])
    : { ok: false };
  let contextName = null;
  let contextHost = null;
  if (ctx.ok) {
    try {
      const j = JSON.parse(ctx.stdout);
      contextName = j?.[0]?.Name ?? null;
      contextHost = j?.[0]?.Endpoints?.docker?.Host ?? null;
    } catch {
      // Unverifiable context is unsafe; no daemon call follows.
    }
  }
  const verifiedLocalContext =
    contextName === LOCAL_DOCKER_CONTEXT &&
    contextHost === 'npipe:////./pipe/dockerDesktopLinuxEngine';
  const engine =
    cli.ok && verifiedLocalContext
      ? docker(['info', '--format', '{{.OSType}}'])
      : { ok: false, stdout: '' };
  const linuxEngine = engine.ok && engine.stdout === 'linux';
  const containers = linuxEngine
    ? docker(['container', 'ls', '--all', '--quiet'])
    : { ok: false };
  const volumes = linuxEngine
    ? docker(['volume', 'ls', '--quiet'])
    : { ok: false };
  const image = linuxEngine
    ? docker([
        'image',
        'inspect',
        DISPOSABLE_POSTGRES_IMAGE,
        '--format',
        '{{.Id}}'
      ])
    : { ok: false };
  const ids = containers.ok
    ? containers.stdout.split(/\r?\n/u).filter(Boolean)
    : null;
  const names = volumes.ok
    ? volumes.stdout.split(/\r?\n/u).filter(Boolean)
    : null;
  const guard = inspectDisposableDockerSafety({
    dockerClientInstalled: cli.ok,
    engineRunning: engine.ok,
    engineIsLinux: linuxEngine,
    contextName,
    contextHost,
    containerListComplete: containers.ok,
    existingContainerIds: ids,
    volumeListComplete: volumes.ok,
    existingVolumeNames: names,
    imageCacheChecked: linuxEngine,
    imageCached: image.ok,
    environment: env
  });
  return Object.freeze({
    available: guard.safeForDisposableContainer,
    dockerClientInstalled: cli.ok,
    linuxEngineAvailable: linuxEngine,
    imageAlreadyCached: image.ok,
    ...guard,
    willPullImage: false,
    willConnectExistingDatabase: false,
    willStartContainers: false,
    willChangeDockerDesktopSettings: false
  });
}
const psqlArgs = (name, db, role = 'postgres') => [
  'exec',
  '--interactive',
  name,
  'psql',
  '-h',
  '127.0.0.1',
  '-X',
  '-v',
  'ON_ERROR_STOP=1',
  '-U',
  role,
  '-d',
  db,
  '-At',
  '-F',
  '|',
  '-f',
  '-'
];
function sql(name, db, text, role = 'postgres') {
  return docker(psqlArgs(name, db, role), { input: text, timeout: 20000 });
}
function asyncSql(name, db, text, role = 'postgres') {
  return new Promise((resolve) => {
    const proc = spawn(
      'docker',
      ['--context', LOCAL_DOCKER_CONTEXT, ...psqlArgs(name, db, role)],
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      }
    );
    let stdout = '',
      stderr = '',
      done = false;
    const timer = setTimeout(() => {
      if (!done) proc.kill();
    }, 20000);
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', (b) => {
      stdout += b;
    });
    proc.stderr.on('data', (b) => {
      stderr += b;
    });
    proc.on('error', () => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve({ ok: false, stdout: '', stderr: 'process_spawn_error' });
      }
    });
    proc.on('close', (code) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve({
          ok: code === 0,
          stdout: stdout.trim(),
          stderr: stderr.trim()
        });
      }
    });
    proc.stdin.end(text);
  });
}
function fixture(which) {
  const file = new URL(
    '../tests/fixtures/scout-point10x-localpg-' + which + '.sql',
    import.meta.url
  );
  return readFileSync(fileURLToPath(file), 'utf8');
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha = 'a'.repeat(40);
const scope = 'reader-reward-beta-point-10x-staging-atomic-rollback';
const claim = (comment, op, hold = 0) =>
  'BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE; SELECT nl_point10x_control.claim_once(' +
  comment +
  ",'" +
  op +
  "','" +
  scope +
  "','" +
  sha +
  "',0,0," +
  hold +
  '); COMMIT;';
const exact = (r, v) => r.ok && r.stdout.trim() === v;
const fail = (reason) => {
  const err = new Error(reason);
  err.name = 'DisposablePostgresProofFailure';
  throw err;
};
const check = (r, v, reason) => {
  if (!exact(r, v)) fail(reason);
};
async function proveInContainer(container) {
  const reports = [];
  function record(name, pass, detail = '') {
    reports.push({ name, pass, detail });
    if (!pass) fail('failed_synthetic_postgres_assertion:' + name);
  }
  check(
    sql(container, 'postgres', 'CREATE DATABASE ' + CONTROL_DATABASE + ';'),
    'CREATE DATABASE',
    'control_db_create_failed'
  );
  check(
    sql(container, 'postgres', 'CREATE DATABASE ' + STAGE_DATABASE + ';'),
    'CREATE DATABASE',
    'stage_db_create_failed'
  );
  const ctrl = sql(container, CONTROL_DATABASE, fixture('control'));
  if (!ctrl.ok) fail('control_fixture_failed');
  const stage = sql(container, STAGE_DATABASE, fixture('stage'));
  if (!stage.ok) fail('stage_fixture_failed');
  const [a, b] = await Promise.all([
    asyncSql(container, CONTROL_DATABASE, claim(9001, 'local-cas-a', 1.2)),
    (async () => {
      await sleep(150);
      return asyncSql(
        container,
        CONTROL_DATABASE,
        claim(9002, 'local-cas-b', 0)
      );
    })()
  ]);
  record(PROOF_SCENARIOS[0], Number(a.ok) + Number(b.ok) === 1);
  const count = sql(
    container,
    CONTROL_DATABASE,
    'SELECT count(*),min(fencing_epoch) FROM nl_point10x_control.spent;'
  );
  check(count, '1|1', 'spent_count_epoch_mismatch');
  const domain = sql(
    container,
    CONTROL_DATABASE,
    'SELECT version,fencing_epoch,phase FROM nl_point10x_control.domain;'
  );
  check(domain, '1|1|claimed', 'domain_version_epoch_mismatch');
  const replay = sql(container, CONTROL_DATABASE, claim(9001, 'local-cas-a'));
  record(PROOF_SCENARIOS[1], !replay.ok);
  record(PROOF_SCENARIOS[2], exact(domain, '1|1|claimed'));
  // The result of the earlier commit is deliberately ignored: only the
  // independently read primary spent state is used (not a socket-loss test).
  const ack = sql(
    container,
    CONTROL_DATABASE,
    'SELECT count(*),max(fencing_epoch) FROM nl_point10x_control.spent;'
  );
  record(
    PROOF_SCENARIOS[3],
    exact(ack, '1|1'),
    'simulated_ack_discard_readback'
  );
  const asService = (command) =>
    sql(container, STAGE_DATABASE, command, 'nl_point10x_fake_service');
  const pre = asService(
    'INSERT INTO nl_point10x_stage.point_ledger VALUES (1,5);'
  );
  record(PROOF_SCENARIOS[4], pre.ok);
  check(
    sql(
      container,
      STAGE_DATABASE,
      "UPDATE nl_point10x_stage.fence SET frozen=true,fencing_epoch=1 WHERE domain='issue294-point10x-all-staging-writers';"
    ),
    'UPDATE 1',
    'freeze_failed'
  );
  for (const [name, command] of [
    [
      PROOF_SCENARIOS[5],
      'INSERT INTO nl_point10x_stage.point_ledger VALUES (2,5);'
    ],
    [
      PROOF_SCENARIOS[6],
      'UPDATE nl_point10x_stage.point_ledger SET point_value=50 WHERE id=1;'
    ],
    [
      PROOF_SCENARIOS[7],
      'DELETE FROM nl_point10x_stage.point_ledger WHERE id=1;'
    ],
    [PROOF_SCENARIOS[8], 'TRUNCATE nl_point10x_stage.point_ledger;'],
    [
      PROOF_SCENARIOS[9],
      'SELECT nl_point10x_stage.synthetic_legacy_award_5(3);'
    ]
  ]) {
    const r = asService(command);
    record(name, !r.ok && r.stderr.includes('POINT10X_FENCE_DENY'));
  }
  const attemptedDisable = asService(
    'ALTER TABLE nl_point10x_stage.point_ledger DISABLE TRIGGER USER;'
  );
  record(PROOF_SCENARIOS[10], !attemptedDisable.ok);
  const fenceReadback = sql(
    container,
    STAGE_DATABASE,
    'SELECT fencing_epoch,frozen FROM nl_point10x_stage.fence;'
  );
  record(PROOF_SCENARIOS[11], exact(fenceReadback, '1|t'));
  // Superuser remains a known BYPASS: it can disable USER triggers.
  // This statement is transactionally rolled back in the disposable DB.
  const privileged = sql(
    container,
    STAGE_DATABASE,
    'BEGIN; ALTER TABLE nl_point10x_stage.point_ledger DISABLE TRIGGER USER;' +
      ' INSERT INTO nl_point10x_stage.point_ledger VALUES (88,5);' +
      ' ROLLBACK;'
  );
  record(
    PROOF_SCENARIOS[12],
    privileged.ok,
    'expected_superuser_bypass_demonstrates_unresolved_prod_acl_risk'
  );
  const conserved = sql(
    container,
    STAGE_DATABASE,
    'SELECT count(*),sum(point_value) FROM nl_point10x_stage.point_ledger;'
  );
  record(PROOF_SCENARIOS[13], exact(conserved, '1|5'));
  return {
    status: 'SYNTHETIC_LOCAL_POSTGRES_PARTIAL_PROOF_NOT_STAGING',
    passed: reports.filter((x) => x.pass).length,
    total: reports.length,
    scenarios: reports,
    independentControlAndStageDatabases: true,
    separatePhysicalPostgresServers: false,
    rpcIsSyntheticNotProduction: true,
    ackLossIsSimulatedNotNetworkDrop: true,
    privilegedOwnerBypassIsStillARealDesignBlocker: true,
    allNineRealWriterPathsVerified: false,
    safeToEnableStaging: false
  };
}
async function run() {
  const permission = checkLocalProofPermission(
    process.env,
    process.argv.slice(2)
  );
  if (!permission.readyForLocalProbe) {
    process.stdout.write(
      JSON.stringify({ status: 'DENIED', blockers: permission.blockers }) + '\n'
    );
    process.exitCode = 2;
    return;
  }
  const available = checkDisposablePostgresAvailability();
  if (!available.available) {
    process.stdout.write(
      JSON.stringify({
        status: 'SKIPPED_UNAVAILABLE',
        availability: available
      }) + '\n'
    );
    return;
  }
  const nonce = randomUUID().replaceAll('-', '').slice(0, 12);
  const spec = disposableDockerArguments(nonce);
  let created = false;
  let startAttempted = false;
  try {
    const finalInventory = checkDisposablePostgresAvailability();
    if (!finalInventory.available)
      fail('docker_inventory_or_context_changed_before_start');
    startAttempted = true;
    const started = docker(spec.args, { timeout: 30000 });
    if (!started.ok) fail('temporary_container_start_failed');
    created = true;
    let ready = false;
    for (let i = 0; i < 80; i++) {
      const r = docker(
        [
          'exec',
          spec.name,
          'pg_isready',
          '-h',
          '127.0.0.1',
          '-U',
          'postgres',
          '-d',
          'postgres'
        ],
        { timeout: 3000 }
      );
      if (r.ok) {
        ready = true;
        break;
      }
      await sleep(250);
    }
    if (!ready) fail('disposable_pg_readiness_failed');
    const report = await proveInContainer(spec.name);
    process.stdout.write(JSON.stringify(report) + '\n');
  } catch (e) {
    process.stderr.write(
      'LOCAL_PROOF_FAILED: ' +
        e.name +
        ': ' +
        String(e.message).replace(/[^a-zA-Z0-9_:.-]/gu, '_') +
        '\n'
    );
    process.exitCode = 1;
  } finally {
    // Even if docker run loses its acknowledgement, inspect ONLY our random
    // name and delete it only when the exact ownership label matches.
    if (created || startAttempted) {
      const label = docker([
        'inspect',
        '--format',
        '{{index .Config.Labels "' + SANDBOX_LABEL + '"}}',
        spec.name
      ]);
      if (label.ok && label.stdout === nonce) {
        const cleaned = docker(['rm', '--force', spec.name], {
          timeout: 30000
        });
        if (!cleaned.ok) {
          process.stderr.write('LOCAL_PROOF_CONTAINER_CLEANUP_UNVERIFIED\n');
          process.exitCode = 1;
        }
      } else {
        process.stderr.write(
          'LOCAL_PROOF_OWNERSHIP_LABEL_MISMATCH_NO_CLEANUP\n'
        );
        process.exitCode = 1;
      }
    }
  }
}
const inCommandLine =
  process.argv[1] &&
  fileURLToPath(import.meta.url).toLowerCase() ===
    process.argv[1].toLowerCase();
if (inCommandLine) {
  const a = process.argv.slice(2);
  if (a.length === 0 || (a.length === 1 && a[0] === '--probe')) {
    process.stdout.write(
      JSON.stringify({
        status: 'READ_ONLY_PROBE',
        availability: checkDisposablePostgresAvailability(),
        requiresOptIn: true,
        source: 'disposable_docker_engine_only'
      }) + '\n'
    );
  } else {
    await run();
  }
}
