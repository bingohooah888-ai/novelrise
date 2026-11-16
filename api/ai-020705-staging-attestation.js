// Public metadata only; never return credentials, manuscript, JWT or AI output.
// This endpoint exists solely to attest an explicitly isolated AI 02-07-05
// Staging Preview. Production, other previews and all POSTs return 404.
const STAGING = 'https://wmlzjgvxgoyrovdhbqbg.supabase.co';
const SHA = /^[0-9a-f]{40}$/u;

export function create020705StagingAttestationHandler(env = process.env) {
  return (req, res) => {
    const allowed =
      req?.method === 'GET' &&
      env?.VERCEL_ENV === 'preview' &&
      env?.NOVELIGHT_AI_020705_STAGING_PREVIEW_ENABLED === 'true' &&
      env?.SUPABASE_URL === STAGING &&
      SHA.test(env?.VERCEL_GIT_COMMIT_SHA ?? '');

    res.setHeader('Cache-Control', 'no-store');
    if (!allowed) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }
    return res.status(200).json({
      target: 'preview',
      commitSha: env.VERCEL_GIT_COMMIT_SHA,
      supabaseUrl: STAGING
    });
  };
}

export default create020705StagingAttestationHandler();
