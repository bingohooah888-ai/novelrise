export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const configured = Boolean(String(process.env.RESEND_API_KEY ?? '').trim());

  return res.status(configured ? 200 : 503).json({
    service: 'beta-author-invite-mail',
    configured
  });
}
