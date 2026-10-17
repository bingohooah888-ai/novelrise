// Read-only, fail-closed inspection of GitHub protection for one-use tags.
// No GitHub mutations, authorization grants, Staging or Preview operations.
// This proves only the returned ruleset snapshot; future execution must
// independently re-fetch evidence immediately before each guarded action.
import { readFileSync } from 'node:fs';

const REPO = 'bingohooah888-ai/novelrise';
const REQUIRED_PREFIX = 'refs/tags/novelight-community-hosted-once-v1-*';
const ACCEPTED_INCLUDES = new Set([REQUIRED_PREFIX, 'refs/tags/*', '~ALL']);

function deny(message) {
  throw new Error('COMMUNITY_HOSTED_REF_PROTECTION_DENIED: ' + message);
}

function fullInventory(pages) {
  if (
    !Array.isArray(pages) ||
    pages.length < 1 ||
    pages.length > 20 ||
    pages.some((page) => !Array.isArray(page) || page.length > 100) ||
    pages.slice(0, -1).some((page) => page.length !== 100) ||
    pages.at(-1).length === 100
  ) {
    deny('ruleset inventory is incomplete or unbounded');
  }
  const ids = new Set();
  const activeTags = [];
  for (const item of pages.flat()) {
    if (
      !Number.isSafeInteger(item?.id) ||
      item.id <= 0 ||
      ids.has(item.id) ||
      !['branch', 'tag', 'push'].includes(item.target) ||
      typeof item.source_type !== 'string' ||
      typeof item.enforcement !== 'string'
    ) {
      deny('malformed or duplicated ruleset inventory');
    }
    ids.add(item.id);
    if (item.target === 'tag' && item.enforcement === 'active') {
      activeTags.push(item);
    }
  }
  return activeTags;
}

function protectsExactReservation(detail, expectedId) {
  if (
    detail?.id !== expectedId ||
    detail.target !== 'tag' ||
    detail.enforcement !== 'active' ||
    detail.source_type !== 'Repository' ||
    detail.source !== REPO ||
    detail.current_user_can_bypass !== 'never' ||
    !Array.isArray(detail.bypass_actors) ||
    detail.bypass_actors.length !== 0
  ) {
    return false;
  }
  const names = detail.conditions?.ref_name;
  if (
    !Array.isArray(names?.include) ||
    !names.include.some((value) => ACCEPTED_INCLUDES.has(value)) ||
    !Array.isArray(names.exclude) ||
    names.exclude.length !== 0
  ) {
    return false;
  }
  const rules = detail.rules;
  if (!Array.isArray(rules)) return false;
  return (
    rules.some((rule) => rule?.type === 'deletion') &&
    rules.some((rule) => rule?.type === 'update')
  );
}

// No claim or cost authorization can be derived from this response.
// Lack of a matching rule, incomplete enumeration, or bypass actors = DENY.
export function inspectCommunityHostedReservationProtection({
  repository,
  inventoryPages,
  tagRuleDetails
}) {
  if (repository !== REPO) deny('unexpected repository');
  const activeTags = fullInventory(inventoryPages);
  if (
    !Array.isArray(tagRuleDetails) ||
    tagRuleDetails.length !== activeTags.length ||
    tagRuleDetails.length > 100
  ) {
    deny('active tag rule details missing or incomplete');
  }
  const byId = new Map();
  for (const detail of tagRuleDetails) {
    if (
      !Number.isSafeInteger(detail?.id) ||
      byId.has(detail.id) ||
      !activeTags.some((entry) => entry.id === detail.id)
    ) {
      deny('tag ruleset detail absent, duplicated or swapped');
    }
    byId.set(detail.id, detail);
  }
  const protectedIds = activeTags
    .filter((entry) => protectsExactReservation(byId.get(entry.id), entry.id))
    .map((entry) => entry.id);
  if (protectedIds.length === 0) {
    deny('no active non-bypassable update/deletion ruleset protects reservation tags');
  }
  return Object.freeze({
    status: 'RESERVATION_TAG_RULESET_READ_ONLY_INSPECTION',
    matchingRulesetIds: Object.freeze([...protectedIds]),
    protectionObserved: true,
    protectionFreshAtExecution: false,
    atomicClaimVerified: false,
    stagingCostApproved: false,
    mayClaim: false,
    mayCreateBranch: false,
    mayDeployPreview: false,
    mayRunBrowser: false,
    runAuthorized: false,
    writeAuthorized: false,
    releaseAuthorized: false
  });
}

if (process.argv[2] === 'validate') {
  try {
    const [repository, pagesPath, detailsPath] = process.argv.slice(3);
    if (
      process.argv.length !== 6 ||
      !pagesPath ||
      !detailsPath
    ) {
      deny('repository, inventory pages and tag details required');
    }
    const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
    const result = inspectCommunityHostedReservationProtection({
      repository,
      inventoryPages: read(pagesPath),
      tagRuleDetails: read(detailsPath)
    });
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch {
    console.error('COMMUNITY_HOSTED_REF_PROTECTION_DENIED: protection could not be verified');
    process.exitCode = 1;
  }
}
