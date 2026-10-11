import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  inspectNovelightUrl,
  listNovelightProperties,
  SearchConsoleError
} from '../../../scripts/nlo-gsc-inspection.mjs';

const runFile = promisify(execFile);
const HOME = 'https://novelight.jp/';
const DOMAIN_PROPERTY = 'sc-domain:novelight.jp';

// Authentication is local to the Windows NLO machine. No OAuth secrets, bearer
// tokens, or user-controlled shell commands may travel through GitHub Issue #1837.
export async function acquireReadOnlyGscToken({
  env = process.env,
  platform = process.platform,
  runner = runFile
} = {}) {
  const provided = String(env.NLO_GSC_ACCESS_TOKEN || '').trim();
  if (provided) return provided;

  const command = platform === 'win32' ? 'cmd.exe' : 'gcloud';
  const args =
    platform === 'win32'
      ? ['/d', '/s', '/c', 'gcloud.cmd', 'auth', 'application-default', 'print-access-token']
      : ['auth', 'application-default', 'print-access-token'];

  let response;
  try {
    response = await runner(command, args, {
      encoding: 'utf8',
      timeout: 15000,
      maxBuffer: 8192,
      windowsHide: true
    });
  } catch {
    // Error objects from external processes can embed stderr and credentials.
    throw new SearchConsoleError('google_local_authorization_required');
  }
  const token = String(response?.stdout || '').trim();
  if (!/^[A-Za-z0-9._~+/=-]{20,4000}$/u.test(token)) {
    throw new SearchConsoleError('google_local_authorization_required');
  }
  return token;
}

function publicText(value, maxLength = 250) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001F\u007F]/gu, '').slice(0, maxLength)
    : null;
}

export async function runGscReadOnlyBridgeAction({
  args,
  env = process.env,
  tokenProvider = acquireReadOnlyGscToken,
  listSites = listNovelightProperties,
  inspect = inspectNovelightUrl
} = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length) {
    throw new SearchConsoleError('gsc_args_must_be_empty');
  }
  if (env.NLO_GSC_BRIDGE_READONLY_ENABLED !== 'true') {
    throw new SearchConsoleError('gsc_bridge_not_authorized');
  }

  try {
    const token = await tokenProvider({ env });
    const sites = await listSites({ token });
    if (!Array.isArray(sites?.properties)) {
      throw new SearchConsoleError('gsc_invalid_properties');
    }
    const matched =
      sites.properties.find((entry) => entry.siteUrl === DOMAIN_PROPERTY) ||
      sites.properties.find((entry) => entry.siteUrl === HOME);
    if (!matched) {
      throw new SearchConsoleError('gsc_property_access_required');
    }

    const result = await inspect({
      token,
      siteUrl: matched.siteUrl,
      inspectionUrl: HOME
    });
    if (result?.status !== 'ok') {
      throw new SearchConsoleError('gsc_inspection_not_available');
    }
    // Only bounded, non-sensitive, index-related metadata enters the GitHub
    // control channel. Never return raw Google JSON, OAuth data or tokens.
    return JSON.stringify({
      source: 'google_search_console_url_inspection_api',
      inspectionUrl: HOME,
      indexStatus: ['indexed', 'not_indexed', 'unknown'].includes(result.indexStatus)
        ? result.indexStatus
        : 'unknown',
      verdict: publicText(result.verdict, 64),
      coverageState: publicText(result.coverageState),
      lastCrawlTime: publicText(result.lastCrawlTime, 40),
      googleCanonical: publicText(result.googleCanonical, 360),
      userCanonical: publicText(result.userCanonical, 360),
      robotsTxtState: publicText(result.robotsTxtState, 64),
      indexingState: publicText(result.indexingState, 64),
      pageFetchState: publicText(result.pageFetchState, 64)
    }, null, 2);
  } catch (error) {
    // Prevent external provider error messages / request headers from escaping.
    if (error instanceof SearchConsoleError) throw error;
    throw new SearchConsoleError('gsc_readonly_request_failed');
  }
}
