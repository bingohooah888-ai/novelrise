import { isInvitePreviewToken } from './_lib/beta-author-invite-preview-token.js';

function privateHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

export default async function handler(req, res) {
  privateHeaders(res);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const valid = isInvitePreviewToken(req.body?.token, process.env);
    return res.status(200).json({
      valid,
      mode: 'invite_preview',
      authCreationEnabled: false,
      dataMutationEnabled: false
    });
  } catch (error) {
    console.error('NOVELIGHT invite preview validation unavailable', {
      code: error?.code ?? 'configuration_unavailable'
    });
    return res.status(503).json({ error: 'PREVIEW_VALIDATION_UNAVAILABLE' });
  }
}
