import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import {
  LOCAL_DOCKER_CONTEXT,
  LOCAL_DOCKER_PIPE,
  BLOCKED_DOCKER_ENV_KEYS,
  inspectDisposableDockerSafety
} from '../scripts/scout-point10x-docker-inventory-policy.mjs';
import {
  checkLocalProofPermission,
  checkDisposablePostgresAvailability
} from '../scripts/scout-point10x-disposable-postgres-proof.mjs';
const base = () => ({
  dockerClientInstalled: true,
  engineRunning: true,
  engineIsLinux: true,
  contextName: LOCAL_DOCKER_CONTEXT,
  contextHost: LOCAL_DOCKER_PIPE,
  containerListComplete: true,
  existingContainerIds: [],
  volumeListComplete: true,
  existingVolumeNames: [],
  imageCacheChecked: true,
  imageCached: true,
  environment: {}
});
const audit = (diff = {}) =>
  inspectDisposableDockerSafety({ ...base(), ...diff });
const denied = (r, code) => {
  assert.equal(r.safeForDisposableContainer, false);
  assert.ok(
    r.blockers.includes(code),
    'expected ' + code + ' got ' + r.blockers.join(',')
  );
  assert.equal(r.engineStartAllowed, false);
  assert.equal(r.mayUseExistingContainers, false);
  assert.equal(r.mayDeleteExistingVolumes, false);
  assert.equal(r.mayPullImages, false);
  assert.equal(r.mayContactRemoteDocker, false);
  assert.ok(Object.isFrozen(r));
  assert.ok(Object.isFrozen(r.blockers));
};
test('exact desktop-linux Docker named pipe is pinned', () => {
  assert.equal(LOCAL_DOCKER_CONTEXT, 'desktop-linux');
  assert.equal(LOCAL_DOCKER_PIPE, 'npipe:////./pipe/dockerDesktopLinuxEngine');
});
test('synthetic clean inventory has a hypothetical safe result', () => {
  const r = audit();
  assert.equal(r.safeForDisposableContainer, true);
  assert.equal(r.blockers.length, 0);
  assert.equal(r.existingContainerCount, 0);
  assert.equal(r.existingVolumeCount, 0);
  assert.equal(r.containerInventoryVerified, true);
  assert.equal(r.volumeInventoryVerified, true);
  assert.equal(r.imageCacheVerified, true);
  assert.equal(r.inspectionOnly, true);
  assert.equal(r.engineStartAllowed, false);
});
test('empty inventory must never be inferred from missing evidence', () => {
  const r = inspectDisposableDockerSafety();
  denied(r, 'existing_containers_cannot_be_audited');
  denied(r, 'existing_volumes_cannot_be_audited');
  assert.equal(r.existingContainerCount, null);
  assert.equal(r.existingVolumeCount, null);
});
for (const change of [
  ['client_missing', { dockerClientInstalled: false }, 'docker_client_missing'],
  [
    'engine_off',
    { engineRunning: false },
    'docker_linux_engine_not_running_do_not_start'
  ],
  [
    'wrong_os',
    { engineIsLinux: false },
    'docker_linux_engine_not_running_do_not_start'
  ],
  [
    'remote_context',
    { contextName: 'production' },
    'not_verified_local_docker_desktop_linux_pipe'
  ],
  [
    'remote_tcp',
    { contextHost: 'tcp://remote-host:2376' },
    'not_verified_local_docker_desktop_linux_pipe'
  ],
  [
    'linux_socket',
    { contextHost: 'unix:///var/run/docker.sock' },
    'not_verified_local_docker_desktop_linux_pipe'
  ],
  [
    'unknown_context',
    { contextName: null },
    'not_verified_local_docker_desktop_linux_pipe'
  ],
  [
    'missing_container_inventory',
    { containerListComplete: false },
    'existing_containers_cannot_be_audited'
  ],
  [
    'null_container_list',
    { existingContainerIds: null },
    'existing_containers_cannot_be_audited'
  ],
  [
    'existing_stopped_container',
    { existingContainerIds: ['c1'] },
    'existing_containers_present_preserve_user_environment'
  ],
  [
    'existing_multiple_containers',
    { existingContainerIds: ['c1', 'c2'] },
    'existing_containers_present_preserve_user_environment'
  ],
  [
    'missing_volume_inventory',
    { volumeListComplete: false },
    'existing_volumes_cannot_be_audited'
  ],
  [
    'null_volume_list',
    { existingVolumeNames: null },
    'existing_volumes_cannot_be_audited'
  ],
  [
    'existing_volume',
    { existingVolumeNames: ['user-work'] },
    'existing_volumes_present_preserve_user_environment'
  ],
  [
    'missing_image_cache_check',
    { imageCacheChecked: false },
    'image_cache_not_checked'
  ],
  [
    'missing_image',
    { imageCached: false },
    'cached_postgres_image_missing_no_pull'
  ]
])
  test('fail-closed inventory: ' + change[0], () => {
    const r = audit(change[1]);
    denied(r, change[2]);
  });
test('known nonempty inventory is not reported as zero', () => {
  const r = audit({
    existingContainerIds: ['a', 'b'],
    existingVolumeNames: ['important-volume']
  });
  denied(r, 'existing_containers_present_preserve_user_environment');
  denied(r, 'existing_volumes_present_preserve_user_environment');
  assert.equal(r.existingContainerCount, 2);
  assert.equal(r.existingVolumeCount, 1);
});
test('all endpoint overrides are explicitly enumerated', () => {
  assert.deepEqual(
    [...BLOCKED_DOCKER_ENV_KEYS],
    [
      'DOCKER_HOST',
      'DOCKER_CONTEXT',
      'DOCKER_TLS_VERIFY',
      'DOCKER_CERT_PATH',
      'DOCKER_CONFIG',
      'DOCKER_API_VERSION'
    ]
  );
  assert.ok(Object.isFrozen(BLOCKED_DOCKER_ENV_KEYS));
});
for (const key of BLOCKED_DOCKER_ENV_KEYS) {
  test(
    'remote Docker override refuses even if inventory claims healthy: ' + key,
    () => {
      const env = { [key]: 'remote-or-override' };
      const r = audit({ environment: env });
      denied(r, 'docker_endpoint_environment_override');
      assert.deepEqual(r.environmentOverrideKeys, [key]);
      const permission = checkLocalProofPermission(
        { NOVELIGHT_POINT10X_LOCAL_PG: 'I_ACCEPT_DISPOSABLE_DB', ...env },
        ['--run']
      );
      assert.equal(permission.readyForLocalProbe, false);
      assert.ok(
        permission.blockers.includes('docker_endpoint_override_detected:' + key)
      );
    }
  );
}
test('multiple override keys cannot be hidden by one another', () => {
  const r = audit({
    environment: {
      DOCKER_HOST: 'tcp://remote:2376',
      DOCKER_CONTEXT: 'production'
    }
  });
  denied(r, 'docker_endpoint_environment_override');
  assert.equal(r.environmentOverrideKeys.length, 2);
});
test('blank overrides are not interpreted as a connection target', () => {
  const r = audit({ environment: { DOCKER_HOST: '  ', DOCKER_CONTEXT: '' } });
  assert.equal(r.safeForDisposableContainer, true);
});
test('actual Docker Desktop engine-off probe is read-only and NO-GO', () => {
  const check = checkDisposablePostgresAvailability();
  assert.equal(check.available, false);
  assert.equal(check.engineStartAllowed, false);
  assert.equal(check.willChangeDockerDesktopSettings, false);
  assert.equal(check.willStartContainers, false);
  assert.equal(check.willPullImage, false);
  assert.equal(check.willConnectExistingDatabase, false);
});
test('external endpoint variable stops probe before any Docker CLI access', () => {
  const r = checkDisposablePostgresAvailability({
    DOCKER_HOST: 'tcp://production-host:2376'
  });
  assert.equal(r.available, false);
  denied(r, 'docker_endpoint_environment_override');
  assert.equal(r.dockerClientInstalled, false);
  assert.equal(r.imageCacheVerified, false);
});
test('harness probes container and volume inventories in read-only mode', () => {
  const src = readFileSync(
    fileURLToPath(
      new URL(
        '../scripts/scout-point10x-disposable-postgres-proof.mjs',
        import.meta.url
      )
    ),
    'utf8'
  );
  assert.match(src, /'container',\s*'ls',\s*'--all',\s*'--quiet'/u);
  assert.match(src, /'volume',\s*'ls',\s*'--quiet'/u);
  assert.match(src, /inspectDisposableDockerSafety/u);
  assert.match(src, /docker_inventory_or_context_changed_before_start/u);
  assert.match(src, /LOCAL_DOCKER_CONTEXT/u);
  assert.match(src, /'--context',\s*LOCAL_DOCKER_CONTEXT/u);
  assert.match(src, /label\.stdout\s*===\s*nonce/u);
  assert.match(src, /created\s*\|\|\s*startAttempted/u);
});
test('explicit --probe with hostile DOCKER_HOST never contacts remote engine', () => {
  const file = fileURLToPath(
    new URL(
      '../scripts/scout-point10x-disposable-postgres-proof.mjs',
      import.meta.url
    )
  );
  const env = { ...process.env, DOCKER_HOST: 'tcp://not-a-real-endpoint:2376' };
  delete env.DOCKER_CONTEXT;
  const r = spawnSync(process.execPath, [file, '--probe'], {
    env,
    encoding: 'utf8',
    timeout: 8000
  });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.status, 'READ_ONLY_PROBE');
  assert.equal(j.availability.available, false);
  assert.equal(j.availability.dockerClientInstalled, false);
  assert.ok(
    j.availability.blockers.includes('docker_endpoint_environment_override')
  );
});
