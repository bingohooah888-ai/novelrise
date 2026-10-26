// Serve a compact, verifiable card response before the static homepage route.
// The standard vercel.json rewrite cannot override an existing index.html.
export const config = { matcher: '/' };

const HOME_URL = 'https://novelight.jp/';
const IMAGE_URL =
  'https://novelight.jp/assets/ogp/novelight-card-20261022.png?home_card=20261026';

const cardHtml = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>NOVELIGHT｜まだ知らない物語に出会う場所</title>
<link rel="canonical" href="${HOME_URL}">
<meta name="description" content="話題になっていなくても、心を揺さぶる物語はきっとある。あなたの次の一冊を探しにいこう。">
<meta property="og:type" content="website">
<meta property="og:site_name" content="NOVELIGHT">
<meta property="og:url" content="${HOME_URL}">
<meta property="og:title" content="NOVELIGHT｜まだ知らない物語に出会う場所">
<meta property="og:description" content="話題になっていなくても、心を揺さぶる物語はきっとある。あなたの次の一冊を探しにいこう。">
<meta property="og:image" content="${IMAGE_URL}">
<meta property="og:image:secure_url" content="${IMAGE_URL}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@NOVELIGHT_jp">
<meta name="twitter:title" content="NOVELIGHT｜まだ知らない物語に出会う場所">
<meta name="twitter:description" content="話題になっていなくても、心を揺さぶる物語はきっとある。あなたの次の一冊を探しにいこう。">
<meta name="twitter:image" content="${IMAGE_URL}">
</head>
<body><a href="${HOME_URL}">NOVELIGHTのトップページへ</a></body>
</html>`;

export default function middleware(request) {
  const url = new URL(request.url);
  const userAgent = request.headers.get('user-agent') || '';

  // Do not change the browser homepage, other paths, or API requests.
  if (
    url.pathname !== '/' ||
    (request.method !== 'GET' && request.method !== 'HEAD') ||
    !userAgent.toLowerCase().includes('twitterbot')
  ) {
    return;
  }

  // Explicit no-store avoids sharing a bot-only response with real visitors.
  return new Response(request.method === 'HEAD' ? null : cardHtml, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      vary: 'User-Agent',
      'x-novelight-card-route': 'twitterbot-home-middleware-v1'
    }
  });
}
