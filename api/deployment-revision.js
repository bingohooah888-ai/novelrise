const commitPattern = /^[0-9a-f]{40}$/;

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const commitSha = process.env.VERCEL_GIT_COMMIT_SHA || '';
  if (!commitPattern.test(commitSha)) {
    return res.status(503).json({
      error: 'Deployment revision unavailable'
    });
  }

  return res.status(200).json({ commitSha });
}
