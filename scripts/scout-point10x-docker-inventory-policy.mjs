// NOVELIGHT βScout Point10x — pure/read-only Docker Desktop inventory gate.
// NO Docker/DB/network calls. Never authorizes an existing container mutation.
export const LOCAL_DOCKER_CONTEXT = 'desktop-linux';
export const LOCAL_DOCKER_PIPE = 'npipe:////./pipe/dockerDesktopLinuxEngine';
export const BLOCKED_DOCKER_ENV_KEYS = Object.freeze([
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_TLS_VERIFY',
  'DOCKER_CERT_PATH',
  'DOCKER_CONFIG',
  'DOCKER_API_VERSION'
]);
const unique = (arr) => Object.freeze([...new Set(arr)]);
export function inspectDisposableDockerSafety({
  dockerClientInstalled = false,
  engineRunning = false,
  engineIsLinux = false,
  contextName = null,
  contextHost = null,
  containerListComplete = false,
  existingContainerIds = null,
  volumeListComplete = false,
  existingVolumeNames = null,
  imageCacheChecked = false,
  imageCached = false,
  environment = {}
} = {}) {
  const blockers = [];
  if (!dockerClientInstalled) blockers.push('docker_client_missing');
  if (contextName !== LOCAL_DOCKER_CONTEXT || contextHost !== LOCAL_DOCKER_PIPE)
    blockers.push('not_verified_local_docker_desktop_linux_pipe');
  if (!engineRunning || !engineIsLinux)
    blockers.push('docker_linux_engine_not_running_do_not_start');
  const endpointKeys = BLOCKED_DOCKER_ENV_KEYS.filter(
    (k) => typeof environment?.[k] === 'string' && environment[k].trim()
  );
  if (endpointKeys.length)
    blockers.push('docker_endpoint_environment_override');
  if (!containerListComplete || !Array.isArray(existingContainerIds))
    blockers.push('existing_containers_cannot_be_audited');
  else if (existingContainerIds.length)
    blockers.push('existing_containers_present_preserve_user_environment');
  if (!volumeListComplete || !Array.isArray(existingVolumeNames))
    blockers.push('existing_volumes_cannot_be_audited');
  else if (existingVolumeNames.length)
    blockers.push('existing_volumes_present_preserve_user_environment');
  if (!imageCacheChecked) blockers.push('image_cache_not_checked');
  else if (!imageCached) blockers.push('cached_postgres_image_missing_no_pull');
  return Object.freeze({
    safeForDisposableContainer: blockers.length === 0,
    blockers: unique(blockers),
    engineStartAllowed: false,
    mayUseExistingContainers: false,
    mayDeleteExistingVolumes: false,
    mayPullImages: false,
    mayContactRemoteDocker: false,
    inspectionOnly: true,
    containerInventoryVerified:
      containerListComplete && Array.isArray(existingContainerIds),
    volumeInventoryVerified:
      volumeListComplete && Array.isArray(existingVolumeNames),
    imageCacheVerified: imageCacheChecked,
    environmentOverrideKeys: unique(endpointKeys),
    existingContainerCount:
      containerListComplete && Array.isArray(existingContainerIds)
        ? existingContainerIds.length
        : null,
    existingVolumeCount:
      volumeListComplete && Array.isArray(existingVolumeNames)
        ? existingVolumeNames.length
        : null
  });
}
