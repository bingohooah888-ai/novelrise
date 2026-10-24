/** NOVELIGHT's single source of truth for the site-wide favicon. */
export const SITE_FAVICON_LINK =
  '<link rel="icon" type="image/x-icon" href="/favicon.ico?v=20261022">';

/** Add the canonical icon once, without altering other head metadata. */
export function ensureFaviconHtml(html) {
  if (typeof html !== 'string' || !/<head(?:\s[^>]*)?>/iu.test(html) || !/<\/head\s*>/iu.test(html)) {
    return html;
  }

  // A materialized page must be a no-op on every subsequent sync.
  const currentIcons = [...html.matchAll(/<link\b[^>]*>/giu)]
    .map(([tag]) => tag)
    .filter((tag) => {
      const rel = tag.match(/\brel\s*=\s*(["'])([^"']+)\1/iu)?.[2];
      return rel?.toLowerCase().trim().split(/\s+/u).includes('icon');
    });
  if (currentIcons.length === 1 && currentIcons[0] === SITE_FAVICON_LINK) {
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
