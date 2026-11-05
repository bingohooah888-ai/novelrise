import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import {
  DISPOSABLE_POSTGRES_IMAGE,
  OPT_IN_NAME,
  OPT_IN_VALUE,
  SANDBOX_LABEL,
  CONTROL_DATABASE,
  STAGE_DATABASE,
  PROOF_SCENARIOS,
  checkLocalProofPermission,
  disposableDockerArguments
} from '../scripts/scout-point10x-disposable-postgres-proof.mjs';

const harnessUrl = new URL(
  '../scripts/scout-point10x-disposable-postgres-proof.mjs',
  import.meta.url
);
const harnessPath = fileURLToPath(harnessUrl);
const file = (which) =>
  readFileSync(
    fileURLToPath(
      new URL(
        '../tests/fixtures/scout-point10x-localpg-' + which + '.sql',
        import.meta.url
      )
    ),
    'utf8'
  );
const script = () => readFileSync(harnessPath, 'utf8');
const nonce = 'a1b2c3d4e5f6';
const permission = (env = {}, args = ['--run']) =>
  checkLocalProofPermission(env, args);
const optIn = () => ({ [OPT_IN_NAME]: OPT_IN_VALUE });

test('explicit fixed docker image cannot be substituted with an arbitrary URL', () => {
  assert.equal(DISPOSABLE_POSTGRES_IMAGE, 'postgres:16-alpine');
  assert.equal(CONTROL_DATABASE, 'nl_point10x_control');
  assert.equal(STAGE_DATABASE, 'nl_point10x_stage');
  assert.notEqual(CONTROL_DATABASE, STAGE_DATABASE);
});
test('no opt-in means no PostgreSQL container may start', () => {
  const r = permission();
  assert.equal(r.readyForLocalProbe, false);
  assert.ok(r.blockers.includes('explicit_local_only_opt_in_missing'));
  assert.equal(r.mayContactSupabase, false);
  assert.equal(r.mayUseExistingPgHost, false);
});
test('standalone --run must have independent opt-in', () => {
  const r = permission(optIn());
  assert.equal(r.readyForLocalProbe, true);
  assert.equal(r.blockers.length, 0);
  assert.equal(r.mayRunProduction, false);
});
for (const args of [
  [],
  ['--probe'],
  ['--run', '--unsafe'],
  ['--run', '--run'],
  ['--docker-socket'],
  ['--production'],
  ['--staging'],
  ['--run', '--project=real']
]) {
  test('unknown command line rejected: ' + args.join(','), () => {
    const r = permission(optIn(), args);
    assert.ok(r.blockers.includes('exact_run_flag_required'));
  });
}
test('incorrect opt-in value is not enough', () => {
  const r = permission({ [OPT_IN_NAME]: 'yes' });
  assert.ok(r.blockers.includes('explicit_local_only_opt_in_missing'));
});
for (const key of [
  'DATABASE_URL',
  'SUPABASE_DB_URL',
  'SUPABASE_URL',
  'POSTGRES_URL',
  'PGHOST',
  'PGSERVICE',
  'PGPORT'
]) {
  test('external environment disables execution: ' + key, () => {
    const env = { ...optIn(), [key]: 'fake-remote-service' };
    const r = permission(env);
    assert.equal(r.readyForLocalProbe, false);
    assert.ok(
      r.blockers.includes('external_database_environment_present:' + key)
    );
  });
}
test('empty environment connection strings are ignored', () => {
  const env = { ...optIn(), PGHOST: ' ', DATABASE_URL: '' };
  const r = permission(env);
  assert.equal(r.readyForLocalProbe, true);
});
test('generated Docker container name and ownership label are deterministic', () => {
  const r = disposableDockerArguments(nonce);
  assert.equal(r.name, 'nl-point10x-pg-proof-' + nonce);
  assert.equal(r.nonce, nonce);
  assert.ok(r.args.includes(SANDBOX_LABEL + '=' + nonce));
  assert.ok(r.args.includes(DISPOSABLE_POSTGRES_IMAGE));
  assert.ok(Object.isFrozen(r.args));
  assert.ok(Object.isFrozen(r));
});
test('no Docker volume or host bind/published-port is ever generated', () => {
  const r = disposableDockerArguments(nonce);
  assert.equal(r.noDockerVolumes, true);
  assert.equal(r.noPublishedPorts, true);
  assert.equal(r.noNetwork, true);
  assert.equal(r.noImagePull, true);
  assert.deepEqual(r.args.slice(0, 4), [
    'run',
    '--detach',
    '--rm',
    '--pull=never'
  ]);
  assert.ok(r.args.includes('--network=none'));
  assert.ok(r.args.includes('--publish-all=false'));
  for (const disallowed of [
    '-v',
    '--volume',
    '--mount',
    '--publish',
    '-p',
    '--network=host',
    '--network=bridge',
    '--privileged',
    '/var/run/docker.sock'
  ])
    assert.ok(!r.args.includes(disallowed), disallowed);
  assert.ok(r.args.includes('/var/lib/postgresql/data:rw,size=256m'));
  assert.ok(r.args.includes('/var/run/postgresql:rw,size=16m'));
});
test('Docker image is local-only and never pulled by the plan', () => {
  const r = disposableDockerArguments(nonce);
  assert.ok(r.args.includes('--pull=never'));
  assert.ok(r.args.includes('--network=none'));
  assert.equal(r.args.at(-1), DISPOSABLE_POSTGRES_IMAGE);
});
test('random container name cannot be user-provided or inject flags', () => {
  for (const invalid of [
    '',
    '111',
    'f'.repeat(13),
    'g'.repeat(12),
    'A'.repeat(12),
    '--privileged',
    '../production',
    '000000000000;docker'
  ])
    assert.throws(
      () => disposableDockerArguments(invalid),
      /invalid_generated_nonce/u
    );
});
test('fourteen synthetic test scenarios are declared', () => {
  assert.equal(PROOF_SCENARIOS.length, 14);
  assert.equal(new Set(PROOF_SCENARIOS).size, 14);
  assert.ok(
    PROOF_SCENARIOS.includes(
      'control_serializable_claim_race_exactly_one_winner'
    )
  );
  assert.ok(
    PROOF_SCENARIOS.includes(
      'discarded_ack_then_primary_readback_no_second_claim'
    )
  );
  assert.ok(
    PROOF_SCENARIOS.includes('superuser_can_disable_user_triggers_expected_gap')
  );
  assert.ok(
    PROOF_SCENARIOS.includes('fake_service_role_cannot_disable_triggers')
  );
  assert.ok(
    PROOF_SCENARIOS.includes(
      'stage_fence_epoch_matches_primary_and_remains_closed'
    )
  );
  assert.ok(Object.isFrozen(PROOF_SCENARIOS));
});
test('control fixture uses a dedicated schema and immutable spent identity constraints', () => {
  const src = file('control');
  assert.match(src, /LOCAL_TEST_CONTROL_DATABASE_REQUIRED/u);
  assert.match(src, /current_database\(\)/u);
  assert.match(src, /CREATE SCHEMA nl_point10x_control/u);
  assert.match(src, /PRIMARY KEY \(issue_number, comment_id\)/u);
  assert.match(src, /operation_id text NOT NULL UNIQUE/u);
  assert.match(src, /UNIQUE \(scope, candidate_sha\)/u);
  assert.match(src, /UNIQUE \(fencing_epoch\)/u);
  assert.match(src, /CHECK \(fencing_epoch > 0\)/u);
  assert.match(src, /REVOKE ALL ON FUNCTION/u);
});
test('control fixture locks the one mutation domain row before one-time insert', () => {
  const src = file('control');
  const lock = src.indexOf('FOR UPDATE;');
  const insert = src.indexOf('INSERT INTO nl_point10x_control.spent');
  const update = src.indexOf('UPDATE nl_point10x_control.domain');
  assert.ok(lock >= 0 && insert > lock && update > insert);
  assert.match(src, /v_version <> p_expected_version/u);
  assert.match(src, /v_epoch <> p_expected_epoch/u);
  assert.match(src, /phase = 'claimed'/u);
  assert.match(src, /RAISE EXCEPTION 'POINT10X_CAS_BUSY_OR_STALE'/u);
  assert.doesNotMatch(src, /ON CONFLICT DO UPDATE/u);
});
test('control fixture uses no implicit real GitHub OWNER authorization', () => {
  const src = file('control');
  assert.match(src, /TEST-ONLY fixture/u);
  assert.match(src, /SECURITY INVOKER/u);
  assert.doesNotMatch(src, /\bproduction_db\b/iu);
});
test('stage fixture deliberately tests BYPASSRLS against a trigger guard', () => {
  const src = file('stage');
  assert.match(src, /LOCAL_TEST_STAGE_DATABASE_REQUIRED/u);
  assert.match(src, /current_database\(\)/u);
  assert.match(src, /BYPASSRLS/u);
  assert.match(src, /ENABLE ROW LEVEL SECURITY/u);
  assert.match(src, /CREATE TRIGGER nl_point10x_row_fence/u);
  assert.match(src, /CREATE TRIGGER nl_point10x_truncate_fence/u);
  assert.match(src, /BEFORE TRUNCATE/u);
  assert.match(src, /FOR SHARE/u);
  assert.match(src, /RAISE EXCEPTION 'POINT10X_FENCE_DENY'/u);
});
test('stage synthetic legacy SECURITY DEFINER calls same guarded table', () => {
  const src = file('stage');
  assert.match(src, /synthetic_legacy_award_5/u);
  assert.match(src, /SECURITY DEFINER SET search_path = ''/u);
  assert.match(src, /INSERT INTO nl_point10x_stage.point_ledger/u);
  assert.match(src, /REVOKE ALL ON FUNCTION/u);
});
test('only test fixture SQL, no migration or production SQL file created', () => {
  const ctl = file('control'),
    stg = file('stage');
  assert.ok(ctl.startsWith('-- TEST-ONLY'));
  assert.ok(stg.startsWith('-- TEST-ONLY'));
  assert.ok(ctl.includes('Never apply to Supabase'));
  assert.ok(stg.includes('never Supabase'));
  assert.doesNotMatch(
    ctl,
    /\bCREATE DATABASE\s+(?:postgres|production|staging)\b/iu
  );
  assert.doesNotMatch(
    stg,
    /\bCREATE DATABASE\s+(?:postgres|production|staging)\b/iu
  );
});
test('harness only reaches Docker exec to a generated disposable name', () => {
  const src = script();
  assert.match(src, /spawnSync\('docker'/u);
  assert.match(src, /spawn\('docker'/u);
  assert.match(src, /'exec',\s*'--interactive'/u);
  assert.match(src, /docker\(psqlArgs\(/u);
  assert.match(src, /SANDBOX_LABEL/u);
  assert.match(src, /label\.stdout\s*===\s*nonce/u);
  assert.match(src, /docker\(\[\s*'rm',\s*'--force',\s*spec\.name/u);
  assert.doesNotMatch(src, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/u);
});
test('disposable container cleanup happens in finally even on failing test', () => {
  const src = script();
  assert.match(src, /\} finally \{/u);
  assert.match(src, /if\s*\(created\)/u);
  assert.match(src, /LOCAL_PROOF_CONTAINER_CLEANUP_UNVERIFIED/u);
  assert.match(src, /LOCAL_PROOF_OWNERSHIP_LABEL_MISMATCH_NO_CLEANUP/u);
});
test('two psql processes compete for one SERIALIZABLE approval transaction', () => {
  const src = script();
  assert.match(src, /Promise\.all/u);
  assert.match(src, /BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE/u);
  assert.match(src, /Number\(a\.ok\)\s*\+\s*Number\(b\.ok\)\s*===\s*1/u);
  assert.match(src, /spent_count_epoch_mismatch/u);
  assert.match(src, /domain_version_epoch_mismatch/u);
});
test('ack-loss is visibly called simulation, not a real disconnect', () => {
  const src = script();
  assert.match(src, /simulated_ack_discard_readback/u);
  assert.match(src, /ackLossIsSimulatedNotNetworkDrop\s*:\s*true/u);
  assert.match(src, /safeToEnableStaging\s*:\s*false/u);
});
test('successful test admits a known superuser/trigger-disable bypass', () => {
  const src = script();
  assert.match(src, /DISABLE TRIGGER USER/u);
  assert.match(src, /ROLLBACK;/u);
  assert.match(
    src,
    /privilegedOwnerBypassIsStillARealDesignBlocker\s*:\s*true/u
  );
  assert.match(src, /allNineRealWriterPathsVerified\s*:\s*false/u);
});
test('SQL uses only Docker loopback and refuses a host DB URL', () => {
  const src = script();
  assert.match(src, /'127\.0\.0\.1'/u);
  assert.match(src, /checkLocalProofPermission\(\s*process\.env/u);
  assert.match(src, /external_database_environment_present/u);
  assert.match(src, /willConnectExistingDatabase: false/u);
});
test('read-only --probe is safe without an engine or local postgres', () => {
  const r = spawnSync(process.execPath, [harnessPath, '--probe'], {
    encoding: 'utf8',
    timeout: 9000
  });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.status, 'READ_ONLY_PROBE');
  assert.equal(j.requiresOptIn, true);
  assert.equal(j.availability.willPullImage, false);
  assert.equal(j.availability.willStartContainers, false);
  assert.equal(j.availability.willConnectExistingDatabase, false);
});
test('CLI --run rejects absence of explicit opt-in without touching Docker', () => {
  const env = { ...process.env };
  delete env[OPT_IN_NAME];
  const r = spawnSync(process.execPath, [harnessPath, '--run'], {
    encoding: 'utf8',
    timeout: 9000,
    env
  });
  assert.equal(r.status, 2, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.status, 'DENIED');
  assert.ok(j.blockers.includes('explicit_local_only_opt_in_missing'));
});
