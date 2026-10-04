(() => {
  const supabase = window.supabase;
  if (!supabase || typeof supabase.createClient !== 'function') return;
  if (supabase.__novelightScoutSessionStabilized) return;

  const originalCreateClient = supabase.createClient.bind(supabase);
  const retryAttempts = 4;
  const retryDelayMs = 150;
  const delay = (ms) =>
    new Promise((resolve) => window.setTimeout(resolve, ms));

  supabase.createClient = (...args) => {
    const client = originalCreateClient(...args);
    const auth = client?.auth;
    if (!auth || typeof auth.getSession !== 'function') return client;

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

    return client;
  };

  Object.defineProperty(supabase, '__novelightScoutSessionStabilized', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
})();
