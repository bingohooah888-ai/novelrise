import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const INSPECTION_ENDPOINT =
  'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect';
export const SITES_ENDPOINT = 'https://www.googleapis.com/webmasters/v3/sites';
export const REQUIRED_SCOPE =
  'https://www.googleapis.com/auth/webmasters.readonly';

const ROOT_URL = 'https://novelight.jp/';
const ALLOWED_PROPERTIES = new Set(['sc-domain:novelight.jp', ROOT_URL]);

export class SearchConsoleError extends Error {
  constructor(code, httpStatus = null) {
    super(code);
    this.name = 'SearchConsoleError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function validateInspectionUrl(input) {
  let url;
  try {
    url = new URL(String(input || ''));
  } catch {
    throw new SearchConsoleError('invalid_url');
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'novelight.jp' ||
    url.port ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new SearchConsoleError('url_outside_novelight');
  }
  return url.href;
}

export function validateSiteUrl(input) {
  if (!ALLOWED_PROPERTIES.has(input)) {
    throw new SearchConsoleError('unsupported_property');
  }
  return input;
}

function requireToken(token) {
  if (!token || typeof token !== 'string' || /\s/u.test(token)) {
    throw new SearchConsoleError('authorization_required');
  }
  return token;
}

async function requestGoogle(endpoint, token, { fetchImpl = globalThis.fetch, body } = {}) {
  requireToken(token);
  const options = {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json'
    },
    signal: AbortSignal.timeout(12000)
  };
  if (body) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetchImpl(endpoint, options);
  } catch {
    // Never print request headers, bearer tokens, or provider error payloads.
    throw new SearchConsoleError('network_error');
  }
  if (!response || typeof response.ok !== 'boolean') {
    throw new SearchConsoleError('invalid_response');
  }
  if (!response.ok) {
    const codes = {
      401: 'authorization_failed',
      403: 'property_permission_denied',
      404: 'property_not_found',
      429: 'rate_limited'
    };
    throw new SearchConsoleError(
      codes[response.status] || 'google_api_error',
      response.status
    );
  }
  try {
    const parsed = await response.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('invalid JSON shape');
    }
    return parsed;
  } catch {
    throw new SearchConsoleError('invalid_response');
  }
}

export async function listNovelightProperties({
  token,
  fetchImpl = globalThis.fetch
} = {}) {
  const data = await requestGoogle(SITES_ENDPOINT, token, { fetchImpl });
  if (data.siteEntry !== undefined && !Array.isArray(data.siteEntry)) {
    throw new SearchConsoleError('invalid_response');
  }
  const properties = (data.siteEntry || [])
    .filter((entry) => ALLOWED_PROPERTIES.has(entry?.siteUrl))
    .map((entry) => ({
      siteUrl: entry.siteUrl,
      permissionLevel: String(entry.permissionLevel || 'unknown')
    }));
  return { status: 'ok', properties };
}

export async function inspectNovelightUrl({
  token,
  siteUrl,
  inspectionUrl = ROOT_URL,
  fetchImpl = globalThis.fetch
} = {}) {
  const property = validateSiteUrl(siteUrl);
  const url = validateInspectionUrl(inspectionUrl);
  const data = await requestGoogle(INSPECTION_ENDPOINT, token, {
    fetchImpl,
    body: { siteUrl: property, inspectionUrl: url, languageCode: 'ja-JP' }
  });
  const result = data.inspectionResult?.indexStatusResult;
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new SearchConsoleError('inspection_data_unavailable');
  }
  const verdict = String(result.verdict || 'VERDICT_UNSPECIFIED');
  return {
    status: 'ok',
    source: 'google_search_console_url_inspection_api',
    inspectionUrl: url,
    siteUrl: property,
    // Only PASS proves indexed. Do not infer an index state from public search.
    indexStatus:
      verdict === 'PASS'
        ? 'indexed'
        : verdict === 'FAIL' || verdict === 'NEUTRAL'
          ? 'not_indexed'
          : 'unknown',
    verdict,
    coverageState: result.coverageState || null,
    lastCrawlTime: result.lastCrawlTime || null,
    googleCanonical: result.googleCanonical || null,
    userCanonical: result.userCanonical || null,
    robotsTxtState: result.robotsTxtState || null,
    indexingState: result.indexingState || null,
    pageFetchState: result.pageFetchState || null,
    sitemaps: Array.isArray(result.sitemap) ? result.sitemap : [],
    // The API reports the Google-indexed version; this is NOT a live URL test.
    inspectionResultLink: data.inspectionResult.inspectionResultLink || null
  };
}

function optionValue(args, flag) {
  const index = args.indexOf(flag);
  if (index >= 0) return args[index + 1] || '';
  const prefixed = args.find((arg) => arg.startsWith(flag + '='));
  return prefixed ? prefixed.slice(flag.length + 1) : '';
}

export async function runGscCli(
  args = process.argv.slice(2),
  { token = process.env.NLO_GSC_ACCESS_TOKEN, fetchImpl = globalThis.fetch } = {}
) {
  const command = args[0] || 'help';
  if (command === 'help' || command === '--help') {
    return {
      status: 'help',
      commands: [
        'node scripts/nlo-gsc-inspection.mjs sites',
        'node scripts/nlo-gsc-inspection.mjs inspect --site=sc-domain:novelight.jp --url=https://novelight.jp/'
      ],
      authorization: 'NLO_GSC_ACCESS_TOKEN environment variable',
      oauthScope: REQUIRED_SCOPE
    };
  }
  if (command === 'sites') {
    return listNovelightProperties({ token, fetchImpl });
  }
  if (command === 'inspect') {
    return inspectNovelightUrl({
      token,
      fetchImpl,
      siteUrl: optionValue(args, '--site'),
      inspectionUrl: optionValue(args, '--url') || ROOT_URL
    });
  }
  throw new SearchConsoleError('unsupported_command');
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath && invokedPath === resolve(fileURLToPath(import.meta.url))) {
  try {
    console.log(JSON.stringify(await runGscCli(), null, 2));
  } catch (error) {
    console.error(
      JSON.stringify({
        status: 'error',
        code:
          error instanceof SearchConsoleError ? error.code : 'unexpected_error',
        httpStatus:
          error instanceof SearchConsoleError ? error.httpStatus : null
      })
    );
    process.exitCode = 1;
  }
}
