// Hosted Playwright only: never added to any deployed application bundle.
// Unlike a non-writable value, an accessor permits the legitimate strict-mode
// Production OFF initialization while preserving the synthetic test's ON state.
// All other mutations fail closed. Browser network egress is independently
// restricted to the isolated Preview and Supabase branch by the test harness.
export function installHostedCommunityFlags(target = globalThis) {
  if (
    !target ||
    (typeof target !== 'object' && typeof target !== 'function') ||
    Object.getOwnPropertyDescriptor(target, 'NOVELIGHT_COMMUNITY_FLAGS')
  ) {
    throw new Error(
      'HOSTED_COMMUNITY_BROWSER_DENIED: flag target not pristine'
    );
  }
  const flags = Object.freeze({ timeline: true, board: false });
  Object.defineProperty(target, 'NOVELIGHT_COMMUNITY_FLAGS', {
    configurable: false,
    enumerable: true,
    get() {
      return flags;
    },
    set(next) {
      if (
        !next ||
        typeof next !== 'object' ||
        next.timeline !== false ||
        next.board !== false ||
        Object.keys(next).length !== 2
      ) {
        throw new Error(
          'HOSTED_COMMUNITY_BROWSER_DENIED: release gate mutation'
        );
      }
      // Intentionally ignore the public site's single OFF assignment in
      // novelight-client.js. No release state is changed outside Playwright.
    }
  });
}
