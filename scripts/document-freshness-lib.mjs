import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const REGISTRY_PATH = 'docs/DOCUMENT-SOURCE-OF-TRUTH.md';
export const FRESHNESS_POLICY_PATH = 'docs/DOCUMENT-FRESHNESS.md';
export const ALLOWED_DOCUMENT_STATUSES = new Set(['CURRENT', 'ARCHIVED', 'SUPERSEDED']);

const REGISTRY_BEGIN = '<!-- NOVELIGHT_DOCUMENT_REGISTRY_BEGIN -->';
const REGISTRY_END = '<!-- NOVELIGHT_DOCUMENT_REGISTRY_END -->';
const DOC_REF_PATTERN = /(?:AGENTS\.md|docs\/[A-Za-z0-9._/-]+\.md)/gu;

function unique(values) {
  return [...new Set(values)];
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function git(args, options = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  }).trim();
}

export function parseDocumentRegistry(source) {
  const begin = source.indexOf(REGISTRY_BEGIN);
  const end = source.indexOf(REGISTRY_END);
  if (begin === -1 || end === -1 || end <= begin) {
    throw new Error('Document registry markers are missing or malformed.');
  }
  const bounded = source.slice(begin + REGISTRY_BEGIN.length, end);
  const match = bounded.match(/```json\s*([\s\S]*?)\s*```/u);
  if (!match) {
    throw new Error('Document registry must contain exactly one JSON code block between fixed markers.');
  }
  try {
    return JSON.parse(match[1]);
  } catch (error) {
    throw new Error(`Document registry JSON is invalid: ${error.message}`);
  }
}

export function indexRegistry(registry) {
  if (registry.schemaVersion !== 1) {
    throw new Error(`Unsupported document registry schemaVersion: ${registry.schemaVersion}`);
  }
  if (registry.registryStatus !== 'CURRENT') {
    throw new Error('Document Source of Truth registry is not CURRENT.');
  }
  if (registry.registryPath !== REGISTRY_PATH) {
    throw new Error(`Registry path mismatch: expected ${REGISTRY_PATH}.`);
  }
  if (!Array.isArray(registry.documents) || registry.documents.length === 0) {
    throw new Error('Document registry has no document entries.');
  }

  const byPath = new Map();
  const currentByRole = new Map();
  for (const entry of registry.documents) {
    if (!entry || typeof entry.path !== 'string' || !entry.path) {
      throw new Error('Every registry entry requires a non-empty path.');
    }
    if (byPath.has(entry.path)) throw new Error(`Duplicate registry path: ${entry.path}`);
    if (!ALLOWED_DOCUMENT_STATUSES.has(entry.status)) {
      throw new Error(`Unsupported document status for ${entry.path}: ${entry.status}`);
    }
    if (typeof entry.role !== 'string' || !entry.role) {
      throw new Error(`Registry entry ${entry.path} requires a role.`);
    }
    byPath.set(entry.path, entry);
    if (entry.status === 'CURRENT') {
      const paths = currentByRole.get(entry.role) || [];
      paths.push(entry.path);
      currentByRole.set(entry.role, paths);
    }
  }

  for (const entry of registry.documents) {
    if (entry.status !== 'SUPERSEDED') continue;
    if (!entry.supersededBy || typeof entry.supersededBy !== 'string') {
      throw new Error(`SUPERSEDED document lacks supersededBy: ${entry.path}`);
    }
    const successor = byPath.get(entry.supersededBy);
    if (!successor) {
      throw new Error(`SUPERSEDED successor is not registered: ${entry.path} -> ${entry.supersededBy}`);
    }
    if (successor.status !== 'CURRENT') {
      throw new Error(`SUPERSEDED successor must be CURRENT: ${entry.path} -> ${entry.supersededBy}`);
    }
    if (successor.role !== entry.role) {
      throw new Error(`SUPERSEDED successor role mismatch: ${entry.path} -> ${entry.supersededBy}`);
    }
  }

  const singletonRoles = new Set(
    registry.documents.filter((entry) => entry.singletonRole).map((entry) => entry.role)
  );
  for (const role of singletonRoles) {
    const paths = currentByRole.get(role) || [];
    if (paths.length !== 1) {
      throw new Error(`Singleton role ${role} must have exactly one CURRENT document; found ${paths.length}.`);
    }
  }

  const master = byPath.get(registry.masterPath);
  if (!master || master.status !== 'CURRENT' || master.role !== 'master') {
    throw new Error('Registered MASTER is missing, non-CURRENT, or not role=master.');
  }
  const currentMasters = currentByRole.get('master') || [];
  if (currentMasters.length !== 1 || currentMasters[0] !== registry.masterPath) {
    throw new Error('MASTER Source of Truth is not unique.');
  }

  if (!Array.isArray(registry.startupRequiredCurrent)) {
    throw new Error('startupRequiredCurrent must be an array.');
  }
  for (const path of registry.startupRequiredCurrent) {
    const entry = byPath.get(path);
    if (!entry) throw new Error(`Startup-required document is not registered: ${path}`);
    if (entry.status !== 'CURRENT') {
      throw new Error(`Startup-required document is not CURRENT: ${path} (${entry.status})`);
    }
  }

  return { byPath, currentByRole, singletonRoles };
}

export function validateSelectedCurrentDocuments(registry, selectedPaths = []) {
  const { byPath } = indexRegistry(registry);
  const paths = unique([...(registry.startupRequiredCurrent || []), ...selectedPaths]);
  const selected = [];
  for (const path of paths) {
    const entry = byPath.get(path);
    if (!entry) throw new Error(`Selected formal document is not registered: ${path}`);
    if (entry.status !== 'CURRENT') {
      throw new Error(`Selected formal document cannot be used as Current State: ${path} (${entry.status})`);
    }
    selected.push(entry);
  }
  return selected;
}

export function extractDocumentReferences(source) {
  return unique(source.match(DOC_REF_PATTERN) || []);
}

export function verifyCurrentReferences({ registry, readText, exists }) {
  const { byPath } = indexRegistry(registry);
  const errors = [];
  for (const entry of registry.documents.filter((item) => item.status === 'CURRENT')) {
    if (!exists(entry.path)) {
      errors.push(`CURRENT document is missing: ${entry.path}`);
      continue;
    }
    const refs = extractDocumentReferences(readText(entry.path));
    const allowedHistorical = new Set(entry.historicalReferences || []);
    for (const ref of refs) {
      if (!exists(ref)) {
        errors.push(`CURRENT document ${entry.path} references missing document ${ref}`);
        continue;
      }
      const target = byPath.get(ref);
      if (!target) {
        errors.push(`CURRENT document ${entry.path} references unregistered formal document ${ref}`);
        continue;
      }
      if (target.status !== 'CURRENT' && !allowedHistorical.has(ref)) {
        errors.push(`CURRENT document ${entry.path} references ${target.status} document ${ref} without an explicit historical reference exception`);
      }
    }
  }
  return errors;
}

export function verifyRegistryCoverage({ registry, formalPaths }) {
  const { byPath } = indexRegistry(registry);
  const errors = [];
  for (const path of formalPaths) {
    if (!byPath.has(path)) errors.push(`Formal document lacks registry status: ${path}`);
  }
  for (const path of byPath.keys()) {
    if (!formalPaths.includes(path)) errors.push(`Registry points to missing formal document: ${path}`);
  }
  return errors;
}

export function buildFastFreshnessManifest({
  registrySource,
  mainSha,
  resolveBlob,
  selectedPaths = [],
  checkedAt = new Date().toISOString()
}) {
  if (!/^[0-9a-f]{40}$/u.test(mainSha)) {
    throw new Error('Document Freshness Gate requires an authoritative 40-character origin/main SHA.');
  }
  const registry = parseDocumentRegistry(registrySource);
  const selected = validateSelectedCurrentDocuments(registry, selectedPaths);
  const registryBlob = resolveBlob(REGISTRY_PATH);
  const documents = selected.map((entry) => ({
    path: entry.path,
    status: entry.status,
    role: entry.role,
    blob: resolveBlob(entry.path)
  }));
  for (const item of [registryBlob, ...documents.map((entry) => entry.blob)]) {
    if (!/^[0-9a-f]{40}$/u.test(item)) {
      throw new Error('Document Freshness Gate could not resolve a required Git blob.');
    }
  }
  const master = documents.find((entry) => entry.path === registry.masterPath);
  if (!master) throw new Error('Fast Freshness manifest did not include the registered MASTER.');

  return {
    version: 1,
    mode: 'fast',
    checkedAt,
    mainSha,
    registry: {
      path: REGISTRY_PATH,
      status: registry.registryStatus,
      blob: registryBlob,
      sha256: sha256(registrySource)
    },
    master,
    selectedDocuments: documents
  };
}

export function listFormalDocumentsAtRef(ref = 'HEAD') {
  const output = git(['ls-tree', '-r', '--name-only', ref]);
  return output
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter((path) => path === 'AGENTS.md' || /^docs\/[^/]+\.md$/u.test(path));
}

export function verifyRegistryAtRef(ref = 'HEAD') {
  const registrySource = git(['show', `${ref}:${REGISTRY_PATH}`]);
  const registry = parseDocumentRegistry(registrySource);
  const formalPaths = listFormalDocumentsAtRef(ref);
  const coverageErrors = verifyRegistryCoverage({ registry, formalPaths });
  const currentReferenceErrors = verifyCurrentReferences({
    registry,
    readText: (path) => git(['show', `${ref}:${path}`]),
    exists: (path) => formalPaths.includes(path)
  });
  const errors = [...coverageErrors, ...currentReferenceErrors];
  if (errors.length) {
    throw new Error(`Document Freshness structural audit failed:\n- ${errors.join('\n- ')}`);
  }
  return {
    version: 1,
    mode: 'verify',
    ref,
    registryPath: REGISTRY_PATH,
    formalDocumentCount: formalPaths.length,
    currentDocumentCount: registry.documents.filter((entry) => entry.status === 'CURRENT').length,
    archivedDocumentCount: registry.documents.filter((entry) => entry.status === 'ARCHIVED').length,
    supersededDocumentCount: registry.documents.filter((entry) => entry.status === 'SUPERSEDED').length,
    deleteCandidateCount: Array.isArray(registry.deleteCandidates) ? registry.deleteCandidates.length : 0,
    holdCandidateCount: Array.isArray(registry.holdCandidates) ? registry.holdCandidates.length : 0
  };
}

export function auditRegistryAtRef(ref = 'HEAD') {
  const registrySource = git(['show', `${ref}:${REGISTRY_PATH}`]);
  const registry = parseDocumentRegistry(registrySource);
  const structural = verifyRegistryAtRef(ref);
  const candidates = registry.documents.filter(
    (entry) => entry.status !== 'CURRENT' || /LATEST|\d{4}-\d{2}-\d{2}/u.test(entry.path)
  );
  const history = candidates.map((entry) => ({
    path: entry.path,
    status: entry.status,
    role: entry.role,
    supersededBy: entry.supersededBy || null,
    commits: git(['log', '--max-count=3', '--format=%H%x09%cI%x09%s', ref, '--', entry.path])
      .split(/\r?\n/u)
      .filter(Boolean)
  }));
  return { ...structural, mode: 'audit', history };
}

export function writeFreshnessManifest(manifest) {
  const gitDir = git(['rev-parse', '--git-dir']);
  const path = join(gitDir, 'novelight-document-freshness.json');
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return path;
}

export function runFastFreshnessFromOriginMain({ selectedPaths = [], fetchMain = true } = {}) {
  git(['rev-parse', '--is-inside-work-tree']);
  git(['remote', 'get-url', 'origin']);
  if (fetchMain) {
    git(['fetch', '--quiet', 'origin', '+refs/heads/main:refs/remotes/origin/main']);
  }
  const mainSha = git(['rev-parse', 'origin/main']);
  const registrySource = git(['show', `origin/main:${REGISTRY_PATH}`]);
  const manifest = buildFastFreshnessManifest({
    registrySource,
    mainSha,
    selectedPaths,
    resolveBlob: (path) => git(['rev-parse', `origin/main:${path}`])
  });
  return { manifest, statePath: writeFreshnessManifest(manifest) };
}

export function parseSelectedGuideArgs(argv = [], env = process.env) {
  const cli = argv
    .filter((arg) => arg.startsWith('--guide='))
    .map((arg) => arg.slice('--guide='.length).trim())
    .filter(Boolean);
  const fromEnv = String(env.NOVELIGHT_DOCUMENT_GUIDES || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return unique([...cli, ...fromEnv]);
}

export function readRegistryFromDisk(path = REGISTRY_PATH) {
  return parseDocumentRegistry(readFileSync(path, 'utf8'));
}
