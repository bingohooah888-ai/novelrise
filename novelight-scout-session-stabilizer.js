(() => {
  const supabase = window.supabase;
  if (!supabase || typeof supabase.createClient !== 'function') return;
  if (supabase.__novelightScoutSessionStabilized) return;

  const productionUrl = 'https://fiepaguycecrredwrcwx.supabase.co';
  const productionKey = 'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE';
  const originalCreateClient = supabase.createClient.bind(supabase);
  const retryAttempts = 4;
  const retryDelayMs = 150;
  const delay = (ms) =>
    new Promise((resolve) => window.setTimeout(resolve, ms));
  let sharedCanonicalClient = null;

  const stabilizeSessionLookup = (client) => {
    const auth = client?.auth;
    if (!auth || typeof auth.getSession !== 'function') return client;
    if (auth.__novelightScoutSessionLookupStabilized) return client;

    const originalGetSession = auth.getSession.bind(auth);
    auth.getSession = async (...sessionArgs) => {
      let result;
      for (let attempt = 0; attempt < retryAttempts; attempt += 1) {
        result = await originalGetSession(...sessionArgs);
        if (result?.error || result?.data?.session) return result;
        if (attempt + 1 < retryAttempts) await delay(retryDelayMs);
      }
      return result;
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