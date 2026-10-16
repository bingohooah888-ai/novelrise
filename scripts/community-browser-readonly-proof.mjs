// Read-only verification of an immutable, already-created Community Preview.
// No POST, mutation, browser interaction, redeploy or candidate code execution.
export const EXISTING_COMMUNITY_ORIGIN =
  'https://novelrise-pbe0wvv7t-ranobe1.vercel.app';
export const EXISTING_COMMUNITY_SHA =
  '944b406bd3cb1d87a27e038e0d514a0254d30ed2';
export const COMMUNITY_STAGING_SUPABASE =
  'https://wmlzjgvxgoyrovdhbqbg.supabase.co';

function deny(message) {
  throw new Error('COMMUNITY_REUSE_READONLY_DENIED: ' + message);
}

async function protectedGet(path, { bypass, fetchImpl }) {
  if (!/^\/[a-zA-Z0-9._/-]+$/u.test(path) || path.includes('..')) {
    deny('unsafe path');
  }
  const response = await fetchImpl(EXISTING_COMMUNITY_ORIGIN + path, {
    method: 'GET',
    redirect: 'error',
    headers: {
      Accept: path.endsWith('.html') ? 'text/html' : '*/*',
      'x-vercel-protection-bypass': bypass
    },
    signal: AbortSignal.timeout(20000)
  });
  if (response.status !== 200) {
    deny('protected GET failed for ' + path + ' HTTP ' + response.status);
  }
  const size = Number(response.headers.get('content-length') || 0);
  if (size > 200000) deny('response exceeds expected size');
  const body = await response.text();
  if (body.length > 200000) deny('response body exceeds limit');
  return body;
}

export async function verifyCommunityBrowserReadOnly({
  env = process.env,
  fetchImpl = fetch
} = {}) {
  if (env.EXPECTED_REVISION !== EXISTING_COMMUNITY_SHA ||
      env.CANONICAL_STAGING_URL !== EXISTING_COMMUNITY_ORIGIN ||
      env.STAGING_EXPECTED_SUPABASE_URL !== COMMUNITY_STAGING_SUPABASE ||
      !env.VERCEL_AUTOMATION_BYPASS_SECRET ||
      !env.STAGING_EXPECTED_PUBLISHABLE_KEY) {
    deny('expected immutable revision, Preview, Staging or bypass missing');
  }
  const opts = {
    bypass: env.VERCEL_AUTOMATION_BYPASS_SECRET,
    fetchImpl
  };
  const configJson = await protectedGet('/api/staging-browser-config', opts);
  let config;
  try {
    config = JSON.parse(configJson);
  } catch {
    deny('browser config was not valid JSON');
  }
  if (!config || config.supabaseUrl !== COMMUNITY_STAGING_SUPABASE ||
      config.supabasePublishableKey !==
        env.STAGING_EXPECTED_PUBLISHABLE_KEY) {
    deny('deployed browser config differs from dedicated Staging');
  }
  const [html, client, community, flags] = await Promise.all([
    protectedGet('/community.html', opts),
    protectedGet('/novelight-client.js', opts),
    protectedGet('/novelight-community.js', opts),
    protectedGet('/novelight-community-config.js', opts)
  ]);
  const bootstrap = html.indexOf('src="novelight-client.js"');
  const timeline = html.indexOf('src="novelight-community.js"');
  if (!html.includes('<title>交流広場 | NOVELIGHT</title>') ||
      bootstrap < 0 || timeline < bootstrap ||
      !client.includes('installPreviewSupabaseBootstrap();') ||
      !client.includes('loadStagingBrowserConfigSync') ||
      !community.includes('NOVELIGHT_COMMUNITY_FLAGS') ||
      !flags.includes('timeline:false, board:false')) {
    deny('deployed HTML/bootstrap/disabled flags do not match safe contract');
  }
  return {
    origin: EXISTING_COMMUNITY_ORIGIN,
    revision: EXISTING_COMMUNITY_SHA,
    browserTarget: COMMUNITY_STAGING_SUPABASE,
    checked: ['browser-config', 'community-html', 'client-bootstrap',
      'community-script', 'flags-off'],
    interactiveProof: false
  };
}

if (process.argv[2] === 'verify') {
  try {
    const proof = await verifyCommunityExistingPreviewReadOnly();
    console.log('Existing immutable Preview verified via GET only.');
    console.log(JSON.stringify(proof));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
