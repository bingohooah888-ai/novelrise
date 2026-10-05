(() => {
  const supabase = window.supabase;
  if (!supabase || typeof supabase.createClient !== 'function') return;
  if (supabase.__novelightScoutSessionStabilized) return;

  const productionUrl = 'https://fiepaguycecrredwrcwx.supabase.co';
  const productionKey = 'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE';
  const productionStorageKey = 'sb-fiepaguycecrredwrcwx-auth-token';
  const originalCreateClient = supabase.createClient.bind(supabase);
  const retryAttempts = 20;
  const retryDelayMs = 250;
  const delay = (ms) =>
    new Promise((resolve) => window.setTimeout(resolve, ms));
  let sharedCanonicalClient = null;

  const readPersistedCanonicalSession = () => {
    try {
      const raw = window.localStorage?.getItem(productionStorageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  };

  const stabilizeSessionLookup = (client) => {
    const auth = client?.auth;
    if (!auth || typeof auth.getSession !== 'function') return client;
    if (auth.__novelightScoutSessionLookupStabilized) return client;

    const originalGetSession = auth.getSession.bind(auth);
    auth.getSession = async (...sessionArgs) => {
      let result = await originalGetSession(...sessionArgs);
      if (result?.error || result?.data?.session) return result;

      let persistedSession = readPersistedCanonicalSession();
      if (!persistedSession) return result;

      for (let attempt = 1; attempt < retryAttempts; attempt += 1) {
        await delay(retryDelayMs);
        result = await originalGetSession(...sessionArgs);
        if (result?.error || result?.data?.session) return result;
        persistedSession = readPersistedCanonicalSession();
        if (!persistedSession) return result;
      }

      if (typeof auth.setSession !== 'function') return result;
      return auth.setSession(persistedSession);
    };

    Object.defineProperty(auth, '__novelightScoutSessionLookupStabilized', {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false
    });
    return client;
  };

  supabase.createClient = (...args) => {
    const [url, key, options] = args;
    const isCanonicalDefaultClient =
      url === productionUrl && key === productionKey && options === undefined;

    if (isCanonicalDefaultClient && sharedCanonicalClient) {
      return sharedCanonicalClient;
    }

    const client = stabilizeSessionLookup(originalCreateClient(...args));
    if (isCanonicalDefaultClient) sharedCanonicalClient = client;
    return client;
  };

  Object.defineProperty(supabase, '__novelightScoutSessionStabilized', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
})();