// This endpoint only confirms Production for a same-origin deployment URL.
// It intentionally returns no Supabase configuration, tokens, or secrets.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (process.env.VERCEL_ENV !== 'production') {
    return res.status(404).json({ error: 'Not found' });
  }

  return res.status(200).json({ vercelEnv: 'production' });
}
