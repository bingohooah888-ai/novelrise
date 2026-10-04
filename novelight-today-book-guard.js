(() => {
  'use strict';

  const TODAY_RPC = 'novelight_today_book_v1';
  const ACTION_RPC = 'novelight_today_book_record_action_v1';
  const COMPOSITION_RPC_V3 = 'novelight_thumbnail_compositions_v3';
  const COMPOSITION_RPC_V2 = 'novelight_thumbnail_compositions_v2';
  const FALLBACK_CODES = new Set(['42883', '42P01', '42703']);
  const state = { client: null, row: null };

  function installClientHook() {
    const supabase = window.supabase;
    if (!supabase || typeof supabase.createClient !== 'function' || supabase.__novelightTodayBookGuard) return;
    const originalCreateClient = supabase.createClient.bind(supabase);

    supabase.createClient = (...args) => {
      const client = originalCreateClient(...args);
      if (!client || typeof client.rpc !== 'function') return client;

      const originalRpc = client.rpc.bind(client);
      client.rpc = async (fn, params, options) => {
        const result = await originalRpc(fn, params, options);

        if (fn === TODAY_RPC && !result?.error) {
          const row = Array.isArray(result?.data) ? result.data[0] : null;
          if (row) {
            state.client = client;
            state.row = row;

            const existing = String(row.thumbnail_url || '').trim();
            if (!existing.startsWith('https://')) {
              try {
                let composition = await originalRpc(COMPOSITION_RPC_V3, {
                  p_novel_ids: [String(row.novel_id)]
                });
                if (FALLBACK_CODES.has(String(composition?.error?.code || ''))) {
                  composition = await originalRpc(COMPOSITION_RPC_V2, {
                    p_novel_ids: [String(row.novel_id)]
                  });
                }
                if (!composition?.error) {
                  const first = Array.isArray(composition?.data) ? composition.data[0] : null;
                  const renderUrl = String(first?.render_url || '').trim();
                  if (renderUrl.startsWith('https://')) row.thumbnail_url = renderUrl;
                }
              } catch (error) {
                console.warn('Today book official cover unavailable', error);
              }
            }
          }
        }

        return result;
      };
      return client;
    };

    supabase.__novelightTodayBookGuard = true;
  }

  document.addEventListener('click', async event => {
    const button = event.target?.closest?.('.nl-today-read');
    if (!button || !state.client || !state.row) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (button.disabled) return;
    button.disabled = true;

    const novelId = state.row.novel_id;
    const episodeId = state.row.first_episode_id;
    if (!episodeId) {
      button.disabled = false;
      console.error('Today book first episode is missing');
      return;
    }

    try {
      const result = await state.client.rpc(ACTION_RPC, {
        p_novel_id: Number(novelId),
        p_action: 'read_now'
      });
      if (result?.error) throw result.error;
    } catch (error) {
      console.warn('Today book read-now record failed', error);
    }

    window.location.href =
      `episode.html?id=${encodeURIComponent(episodeId)}` +
      `&source=today_book&today_book_novel_id=${encodeURIComponent(novelId)}`;
  }, true);

  installClientHook();
})();