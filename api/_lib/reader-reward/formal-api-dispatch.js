// Future API wiring only. No Vercel api/*.js entrypoint imports this file.
// Existing reader/admin handlers own Auth and admin verification.
const PATH = /^\/api\/[a-z0-9/_-]+$/i;
export function createUnregisteredFormalApiDispatch({
  application,
  readerPath,
  adminPath
} = {}) {
  if (
    typeof application?.readerHttp !== 'function' ||
    typeof application?.adminHttp !== 'function' ||
    !PATH.test(readerPath || '') ||
    !PATH.test(adminPath || '') ||
    readerPath === adminPath ||
    readerPath.includes('//') ||
    adminPath.includes('//')
  )
    throw new TypeError(
      'Approved distinct same-origin API paths and handlers required'
    );
  const routes = Object.freeze({
    reader: readerPath,
    admin: adminPath
  });
  return Object.freeze({
    routes,
    // Future runtime must mount this dispatcher explicitly after approval.
    // No user supplied path may invoke the other handler.
    async dispatch(req, res) {
      const path =
        typeof req?.url === 'string' ? req.url.split('?', 1)[0] : null;
      if (path === readerPath) return application.readerHttp(req, res);
      if (path === adminPath) return application.adminHttp(req, res);
      return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    }
  });
}
