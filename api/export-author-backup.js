import { createClient } from '@supabase/supabase-js';

function bearerToken(authorization) {
  const match =
    typeof authorization === 'string'
      ? authorization.match(/^Bearer\s+(\S+)$/i)
      : null;
  return match?.[1] ?? null;
}

function oneLine(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function formatDate(value) {
  if (!value) return '未設定';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? oneLine(value) : date.toISOString();
}

function formatWarnings(value) {
  if (!Array.isArray(value) || value.length === 0) return 'なし';
  return value.map(oneLine).filter(Boolean).join(', ') || 'なし';
}

export function buildAuthorBackupText({ novels, episodes, generatedAt }) {
  const safeNovels = Array.isArray(novels) ? novels : [];
  const safeEpisodes = Array.isArray(episodes) ? episodes : [];
  const episodesByNovel = new Map();

  for (const episode of safeEpisodes) {
    const key = String(episode.novel_id ?? '');
    const group = episodesByNovel.get(key) ?? [];
    group.push(episode);
    episodesByNovel.set(key, group);
  }

  const lines = [
    'NOVELIGHT 作者バックアップ',
    `生成日時: ${generatedAt.toISOString()}`,
    `作品数: ${safeNovels.length}`,
    `エピソード数: ${safeEpisodes.length}`,
    '',
    '※ このファイルには、バックアップ実行時点であなたが所有する作品とエピソード本文が含まれます。',
    '※ PV・お気に入り等の集計値は作品本文のバックアップ対象外です。',
    ''
  ];

  const knownNovelIds = new Set(safeNovels.map((novel) => String(novel.id)));

  safeNovels.forEach((novel, index) => {
    lines.push('='.repeat(72));
    lines.push(`【作品 ${index + 1}】`);
    lines.push(`作品ID: ${oneLine(novel.id)}`);
    lines.push(`タイトル: ${oneLine(novel.title) || '無題'}`);
    lines.push(`ジャンル: ${oneLine(novel.genre) || '未設定'}`);
    lines.push(`公開状態: ${oneLine(novel.status) || '未設定'}`);
    lines.push(`AI利用区分: ${oneLine(novel.ai_usage) || 'unspecified'}`);
    lines.push(`内容区分: ${oneLine(novel.content_rating) || 'general'}`);
    lines.push(`内容注意: ${formatWarnings(novel.content_warnings)}`);
    lines.push(`作成日時: ${formatDate(novel.created_at)}`);
    lines.push(`初回公開日時: ${formatDate(novel.first_published_at)}`);
    lines.push('');
    lines.push('【作品説明】');
    lines.push(String(novel.description ?? ''));
    lines.push('');

    const workEpisodes = episodesByNovel.get(String(novel.id)) ?? [];
    if (workEpisodes.length === 0) {
      lines.push('【エピソード】なし');
      lines.push('');
      return;
    }

    for (const episode of workEpisodes) {
      const number = episode.episode_number ?? '-';
      lines.push('-'.repeat(72));
      lines.push(
        `【第${oneLine(number)}話】 ${oneLine(episode.title) || '無題'}`
      );
      lines.push(`エピソードID: ${oneLine(episode.id)}`);
      lines.push(`公開状態: ${oneLine(episode.status) || '未設定'}`);
      lines.push(`作成日時: ${formatDate(episode.created_at)}`);
      lines.push(`更新日時: ${formatDate(episode.updated_at)}`);
      lines.push(`公開予約日時: ${formatDate(episode.scheduled_publish_at)}`);
      lines.push('');
      lines.push('【本文】');
      lines.push(String(episode.content ?? ''));
      lines.push('');
    }
  });

  const unmatchedEpisodes = safeEpisodes.filter(
    (episode) => !knownNovelIds.has(String(episode.novel_id))
  );
  if (unmatchedEpisodes.length > 0) {
    lines.push('='.repeat(72));
    lines.push('【関連作品を確認できなかったエピソード】');
    lines.push(
      'データ保護のため、所有者が一致する本文を省略せず収録しています。'
    );
    lines.push('');
    for (const episode of unmatchedEpisodes) {
      lines.push('-'.repeat(72));
      lines.push(
        `【第${oneLine(episode.episode_number ?? '-')}話】 ${oneLine(episode.title) || '無題'}`
      );
      lines.push(`エピソードID: ${oneLine(episode.id)}`);
      lines.push(`作品ID: ${oneLine(episode.novel_id) || '未設定'}`);
      lines.push(`公開状態: ${oneLine(episode.status) || '未設定'}`);
      lines.push('');
      lines.push('【本文】');
      lines.push(String(episode.content ?? ''));
      lines.push('');
    }
  }

  lines.push('='.repeat(72));
  lines.push('NOVELIGHT バックアップ終了');
  lines.push('');
  return lines.join('\n');
}

function isRateLimitError(error) {
  return String(error?.message ?? '').includes('author_backup_rate_limit');
}

export function createAuthorBackupHandler({
  authenticate,
  beginExport,
  loadNovels,
  loadEpisodes,
  completeExport,
  failExport,
  now = () => new Date()
}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const token = bearerToken(req.headers.authorization);
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await authenticate(token);
    if (!user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    let exportId = null;
    try {
      exportId = await beginExport(user.id);
    } catch (error) {
      if (isRateLimitError(error)) {
        res.setHeader('Retry-After', '3600');
        return res.status(429).json({
          error: 'Backup export limit reached',
          code: 'author_backup_rate_limit'
        });
      }
      console.error('Author backup slot failed', {
        code: error?.code || null,
        message: error?.message || null
      });
      return res.status(500).json({ error: 'Backup export failed' });
    }

    try {
      const [novels, episodes] = await Promise.all([
        loadNovels(user.id),
        loadEpisodes(user.id)
      ]);
      const generatedAt = now();
      const text = buildAuthorBackupText({ novels, episodes, generatedAt });

      try {
        await completeExport(exportId, user.id, {
          novelCount: novels.length,
          episodeCount: episodes.length,
          completedAt: generatedAt.toISOString()
        });
      } catch (auditError) {
        console.error('Author backup completion audit failed', {
          code: auditError?.code || null,
          message: auditError?.message || null
        });
      }

      const stamp = generatedAt.toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="novelight-backup-${stamp}.txt"`
      );
      return res.status(200).send(text);
    } catch (error) {
      if (exportId !== null) {
        try {
          await failExport(exportId, user.id);
        } catch (auditError) {
          console.error('Author backup failure audit failed', {
            code: auditError?.code || null,
            message: auditError?.message || null
          });
        }
      }
      console.error('Author backup export failed', {
        code: error?.code || null,
        message: error?.message || null
      });
      return res.status(500).json({ error: 'Backup export failed' });
    }
  };
}

function throwSupabase(error, fallback) {
  if (!error) return;
  const wrapped = new Error(error.message || fallback);
  wrapped.code = error.code || null;
  throw wrapped;
}

function createSupabaseDependencies(supabase) {
  return {
    async authenticate(token) {
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data?.user) return null;
      return data.user;
    },
    async beginExport(userId) {
      const { data, error } = await supabase.rpc(
        'novelight_begin_author_backup_export',
        { p_user_id: userId }
      );
      throwSupabase(error, 'Backup export slot failed');
      if (data === null || data === undefined) {
        throw new Error('Backup export audit id missing');
      }
      return data;
    },
    async loadNovels(userId) {
      const { data, error } = await supabase
        .from('novels')
        .select(
          'id,title,description,genre,status,ai_usage,content_rating,content_warnings,created_at,first_published_at'
        )
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true });
      throwSupabase(error, 'Novel export query failed');
      return data || [];
    },
    async loadEpisodes(userId) {
      const { data, error } = await supabase
        .from('episodes')
        .select(
          'id,novel_id,episode_number,title,content,status,created_at,updated_at,scheduled_publish_at'
        )
        .eq('user_id', userId)
        .order('novel_id', { ascending: true })
        .order('episode_number', { ascending: true })
        .order('id', { ascending: true });
      throwSupabase(error, 'Episode export query failed');
      return data || [];
    },
    async completeExport(exportId, userId, counts) {
      const { error } = await supabase
        .from('author_backup_exports')
        .update({
          status: 'completed',
          novel_count: counts.novelCount,
          episode_count: counts.episodeCount,
          completed_at: counts.completedAt
        })
        .eq('id', exportId)
        .eq('user_id', userId);
      throwSupabase(error, 'Backup completion audit failed');
    },
    async failExport(exportId, userId) {
      const { error } = await supabase
        .from('author_backup_exports')
        .update({ status: 'failed', completed_at: new Date().toISOString() })
        .eq('id', exportId)
        .eq('user_id', userId);
      throwSupabase(error, 'Backup failure audit failed');
    }
  };
}

let productionHandler;

export default function handler(req, res) {
  if (!productionHandler) {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SECRET_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );
    productionHandler = createAuthorBackupHandler(
      createSupabaseDependencies(supabase)
    );
  }

  return productionHandler(req, res);
}
