/** NOVELIGHT's single source of truth for the site-wide favicon. */
export const SITE_FAVICON_LINK =
  '<link rel="icon" type="image/x-icon" href="/favicon.ico?v=20261022">';

/** Add the canonical icon once, without altering other head metadata. */
export function ensureFaviconHtml(html) {
  if (typeof html !== 'string' || !/<head(?:\s[^>]*)?>/iu.test(html) || !/<\/head\s*>/iu.test(html)) {
    return html;
  }

  const withoutOldIcons = html.replace(/<link\b[^>]*>/giu, (tag) => {
    const rel = tag.match(/\brel\s*=\s*(["'])([^"']+)\1/iu)?.[2];
    if (!rel) return tag;
    const tokens = rel.toLowerCase().trim().split(/\s+/u);
    return tokens.includes('icon') ? '' : tag;
  });
  return withoutOldIcons.replace(
    /<head(?:\s[^>]*)?>/iu,
    (head) => head + '\n  ' + SITE_FAVICON_LINK
  );
}
