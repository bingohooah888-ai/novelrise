(function (global) {
  'use strict';

  const STORAGE_PREFIX = 'novelight:reading:v1:';
  const TABLE = 'reader_reading_positions';
  const RECENT_LIMIT = 10;
  let warned = false;

  function clamp(value, min = 0, max = 1) {
    return Math.max(min, Math.min(max, Number(value) || 0));
  }

  function storageKey(novelId) {
    return STORAGE_PREFIX + String(novelId || '');
  }

  function timestamp(value) {
    const time = new Date(value || 0).getTime();
    return Number.isFinite(time) && time > 0 ? time : 0;
  }

  function normalizeProgress(value) {
    if (!value?.novelId || !value?.episodeId) return null;
    const lastReadAt = new Date(value.lastReadAt || 0);
    if (!Number.isFinite(lastReadAt.getTime()) || lastReadAt.getTime() <= 0) return null;
    return {
      novelId: String(value.novelId),
      episodeId: String(value.episodeId),
      episodeNumber: Math.max(0, Number(value.episodeNumber) || 0),
      progressRatio: clamp(value.progressRatio),
      lastReadAt: lastReadAt.toISOString(),
      serverRevision: Math.max(0, Number(value.serverRevision) || 0)
    };
  }

  function readLocal(novelId, storage = global.localStorage) {
    try {
      const parsed = JSON.parse(storage.getItem(storageKey(novelId)) || 'null');
      const normalized = normalizeProgress(parsed);
      return normalized && normalized.novelId === String(novelId) ? normalized : null;
    } catch {
      return null;
    }
  }

  function writeLocal(value, storage = global.localStorage) {
    const normalized = normalizeProgress(value);
    if (!normalized) return false;
    try {
      storage.setItem(storageKey(normalized.novelId), JSON.stringify(normalized));
      return true;
    } catch {
      return false;
    }
  }

  function readRecentLocal(storage = global.localStorage, limit = RECENT_LIMIT) {
    const rows = [];
    try {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
        const novelId = key.slice(STORAGE_PREFIX.length);
        const value = readLocal(novelId, storage);
        if (value) rows.push(value);
      }
    } catch {
      return [];
    }
    return rows
      .sort((a, b) => timestamp(b.lastReadAt) - timestamp(a.lastReadAt))
      .slice(0, Math.max(1, Math.min(Number(limit) || 1, RECENT_LIMIT)));
  }

  function remoteToProgress(row) {
    if (!row) return null;
    return normalizeProgress({
      novelId: row.novel_id,
      episodeId: row.episode_id,
      episodeNumber: row.episode_number,
      progressRatio: row.progress_ratio,
      lastReadAt: row.last_read_at,
      serverRevision: row.revision
    });
  }

  function compareProgress(local, remote) {
    const left = normalizeProgress(local);
    const right = normalizeProgress(remote);
    if (!left && !right) return 0;
    if (!left) return -1;
    if (!right) return 1;
    const leftTime = timestamp(left.lastReadAt);
    const rightTime = timestamp(right.lastReadAt);
    if (leftTime !== rightTime) return leftTime > rightTime ? 1 : -1;
    if (left.serverRevision !== right.serverRevision) {
      return left.serverRevision > right.serverRevision ? 1 : -1;
    }
    if (left.episodeId === right.episodeId && left.progressRatio !== right.progressRatio) {
      return left.progressRatio > right.progressRatio ? 1 : -1;
    }
    return 0;
  }

  function chooseNewest(local, remote) {
    return compareProgress(local, remote) > 0 ? normalizeProgress(local) : normalizeProgress(remote);
  }

  function localCanAdvance(local, remote) {
    const left = normalizeProgress(local);
    const right = normalizeProgress(remote);
    if (!left) return false;
    if (!right) return true;
    if (left.serverRevision !== right.serverRevision) return false;
    return compareProgress(left, right) > 0;
  }

  function warnOnce(error) {
    if (warned) return;
    warned = true;
    console.warn('reading position sync unavailable; continuing with this device only', error);
  }

  async function sessionUser(clientInstance) {
    if (!clientInstance?.auth) return null;
    try {
      const result = await clientInstance.auth.getSession();
      if (result.error) throw result.error;
      return result.data?.session?.user || null;
    } catch (error) {
      warnOnce(error);
      return null;
    }
  }

  function progressSelect(query) {
    return query.select(
      'user_id,novel_id,episode_id,episode_number,progress_ratio,last_read_at,revision,updated_at'
    );
  }

  async function fetchRemoteRows(clientInstance, user, novelIds = null, limit = null) {
    let query = progressSelect(clientInstance.from(TABLE)).eq('user_id', user.id);
    if (Array.isArray(novelIds) && novelIds.length) {
      query = query.in('novel_id', novelIds.map((id) => String(id)));
    }
    query = query.order('last_read_at', { ascending: false });
    if (limit) query = query.limit(limit);
    const result = await query;
    if (result.error) throw result.error;
    return result.data || [];
  }

  async function pushWithUser(clientInstance, user, value) {
    const normalized = normalizeProgress(value);
    if (!normalized) return null;
    const payload = {
      user_id: user.id,
      novel_id: normalized.novelId,
      episode_id: normalized.episodeId,
      episode_number: normalized.episodeNumber,
      progress_ratio: normalized.progressRatio,
      last_read_at: normalized.lastReadAt,
      revision: normalized.serverRevision
    };
    const result = await progressSelect(
      clientInstance.from(TABLE).upsert(payload, { onConflict: 'user_id,novel_id' })
    ).single();
    if (result.error) throw result.error;
    const returned = remoteToProgress(result.data);
    if (!returned) return normalized;

    writeLocal(returned);
    return returned;
  }

  async function syncProgress(clientInstance, value) {
    const normalized = normalizeProgress(value);
    if (!normalized) return null;
    const user = await sessionUser(clientInstance);
    if (!user) return normalized;
    try {
      return await pushWithUser(clientInstance, user, normalized);
    } catch (error) {
      warnOnce(error);
      return normalized;
    }
  }

  function mergeOneLocalRemote(local, remote) {
    if (!remote) return local;
    if (!local) {
      writeLocal(remote);
      return remote;
    }
    if (!localCanAdvance(local, remote)) {
      writeLocal(remote);
      return remote;
    }
    writeLocal(local);
    return normalizeProgress(local);
  }

  async function hydrateMany(clientInstance, novelIds) {
    const ids = Array.from(new Set((novelIds || []).map((id) => String(id)).filter(Boolean)));
    if (!ids.length) return false;
    const user = await sessionUser(clientInstance);
    if (!user) return false;
    try {
      const rows = await fetchRemoteRows(clientInstance, user, ids);
      const remoteByNovel = new Map(
        rows.map((row) => {
          const value = remoteToProgress(row);
          return [String(row.novel_id), value];
        })
      );
      for (const novelId of ids) {
        const local = readLocal(novelId);
        const remote = remoteByNovel.get(novelId) || null;
        const localWins = localCanAdvance(local, remote);
        const merged = mergeOneLocalRemote(local, remote);
        if (local && merged && localWins) {
          void pushWithUser(clientInstance, user, merged).catch(warnOnce);
        }
      }
      return true;
    } catch (error) {
      warnOnce(error);
      return false;
    }
  }

  async function hydrateNovel(clientInstance, novelId) {
    await hydrateMany(clientInstance, [novelId]);
    return readLocal(novelId);
  }

  async function recentProgress(clientInstance, limit = RECENT_LIMIT) {
    const boundedLimit = Math.max(1, Math.min(Number(limit) || 1, RECENT_LIMIT));
    const localBefore = readRecentLocal(global.localStorage, boundedLimit);
    const user = await sessionUser(clientInstance);
    if (!user) return { rows: localBefore, synced: false };
    try {
      const rows = await fetchRemoteRows(clientInstance, user, null, boundedLimit);
      const remoteByNovel = new Map();
      for (const row of rows) {
        const remote = remoteToProgress(row);
        if (!remote) continue;
        remoteByNovel.set(remote.novelId, remote);
        mergeOneLocalRemote(readLocal(remote.novelId), remote);
      }
      for (const local of localBefore) {
        const remote = remoteByNovel.get(local.novelId) || null;
        if (localCanAdvance(local, remote)) {
          writeLocal(local);
          void pushWithUser(clientInstance, user, local).catch(warnOnce);
        }
      }
      return { rows: readRecentLocal(global.localStorage, boundedLimit), synced: true };
    } catch (error) {
      warnOnce(error);
      return { rows: localBefore, synced: false };
    }
  }

  global.NovelightReadingSync = Object.freeze({
    STORAGE_PREFIX,
    TABLE,
    normalizeProgress,
    readLocal,
    writeLocal,
    readRecentLocal,
    compareProgress,
    chooseNewest,
    localCanAdvance,
    syncProgress,
    hydrateNovel,
    hydrateMany,
    recentProgress
  });
})(window);
