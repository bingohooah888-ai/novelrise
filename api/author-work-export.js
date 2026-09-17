import { createClient } from '@supabase/supabase-js';

const NOVEL_COLUMNS = [
  'id',
  'created_at',
  'title',
  'description',
  'genre',
  'status',
  'ai_usage',
  'content_rating',
  'content_warnings',
  'content_policy_version',
  'first_published_at'
].join(',');

const EPISODE_COLUMNS = [
  'id',
  'created_at',
  'episode_number',
  'title',
  'content',
  'status',
  'scheduled_publish_at'
].join(',');

function bearerToken(authorization) {
  const match =
    typeof authorization === 'string'
      ? authorization.match(/^Bearer\s+(\S+)$/i)
      : null;
  return match?.[1] ?? null;
}

function positiveInteger(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizedText(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n');
}

function isoDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? normalizedText(value) : date.toISOString();
}

function warningText(value) {
  return Array.isArray(value) && value.length
    ? value.map((item) => normalizedText(item)).join(', ')
    : '';
}

function isRateLimitError(error) {
  return (
    error?.message === 'author_export_rate_limited' ||
    (error?.code === 'P0001' &&
      String(error?.message ?? '').includes('author_export_rate_limited'))
  );
}

function isNotFoundError(error) {
  return (
    error?.code === 'P0002' ||
    String(error?.message ?? '').includes('export_not_found')
  );
}

export async function authorizeWorkExport(supabase, userId, novelId) {
  const { data, error } = await supabase.rpc('novelight_authorize_work_export', {
    p_user_id: userId,
    p_novel_id: novelId,
    p_format: 'txt'
  });
  if (error) throw error;
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

export async function loadOwnedNovel(supabase, userId, novelId) {
  const { data, error } = await supabase
    .from('novels')
    .select(NOVEL_COLUMNS)
    .eq('id', novelId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function loadOwnedEpisodes(supabase, userId, novelId) {
  const { data, error } = await supabase
    .from('episodes')
    .select(EPISODE_COLUMNS)
    .eq('novel_id', novelId)
    .eq('user_id', userId)
    .order('episode_number', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export function formatAuthorWorkBackup({ novel, episodes, exportedAt }) {
  const output = [
    'NOVELIGHT 作品バックアップ',
    `出力日時: ${isoDate(exportedAt)}`,
    '',
    '【作品情報】',
    `作品ID: ${novel.id}`,
    `タイトル: ${normalizedText(novel.title)}`,
    `ジャンル: ${normalizedText(novel.genre)}`,
    `公開状態: ${normalizedText(novel.status)}`,
    `AI利用区分: ${normalizedText(novel.ai_usage)}`,
    `内容区分: ${normalizedText(novel.content_rating)}`,
    `内容警告: ${warningText(novel.content_warnings)}`,
    `投稿ガイドライン版: ${normalizedText(novel.content_policy_version)}`,
    `作成日時: ${isoDate(novel.created_at)}`,
    `初回公開日時: ${isoDate(novel.first_published_at)}`,
    '',
    'あらすじ:',
    normalizedText(novel.description),
    '',
    `【エピソード】 ${episodes.length}件`
  ];

  for (const episode of episodes) {
    output.push(
      '',
      '========================================================================',
      `エピソードID: ${episode.id}`,
      `話数: ${episode.episode_number ?? ''}`,
      `タイトル: ${normalizedText(episode.title)}`,
      `公開状態: ${normalizedText(episode.status)}`,
      `作成日時: ${isoDate(episode.created_at)}`,
      `予約公開日時: ${isoDate(episode.scheduled_publish_at)}`,
      '',
      '本文:',
      normalizedText(episode.content)
    );
  }

  return `${output.join('\n')}\n`;
}

export function createAuthorWorkExportHandler({
  supabase,
  authorize = authorizeWorkExport,
  loadNovel = loadOwnedNovel,
  loadEpisodes = loadOwnedEpisodes,
  now = () => new Date()
}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const novelId = positiveInteger(req.body?.novelId);
    const format = String(req.body?.format ?? 'txt')
      .trim()
      .toLowerCase();
    if (!novelId || format !== 'txt') {
      return res.status(400).json({ error: 'Invalid request' });
    }

    const token = bearerToken(req.headers.authorization);
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { data: authData, error: authError } =
      await supabase.auth.getUser(token);
    if (authError || !authData.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userId = authData.user.id;

    try {
      await authorize(supabase, userId, novelId);
    } catch (error) {
      if (isRateLimitError(error)) {
        res.setHeader('Retry-After', '600');
        return res.status(429).json({
          error: 'Too many export requests',
          code: 'export_rate_limited'
        });
      }
      if (isNotFoundError(error)) {
        return res.status(404).json({ error: 'Not found' });
      }
      console.error('Author work export authorization failed', {
        code: error?.code ?? null,
        message: error?.message ?? null
      });
      return res.status(500).json({ error: 'Export unavailable' });
    }

    let novel;
    let episodes;
    try {
      [novel, episodes] = await Promise.all([
        loadNovel(supabase, userId, novelId),
        loadEpisodes(supabase, userId, novelId)
      ]);
    } catch (error) {
      console.error('Author work export load failed', {
        code: error?.code ?? null,
        message: error?.message ?? null
      });
      return res.status(500).json({ error: 'Export unavailable' });
    }

    if (!novel) {
      return res.status(404).json({ error: 'Not found' });
    }

    const text = formatAuthorWorkBackup({
      novel,
      episodes,
      exportedAt: now()
    });
    const filename = `novelight-work-${novelId}-backup.txt`;

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`
    );
    return res.status(200).send(`\uFEFF${text}`);
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
    productionHandler = createAuthorWorkExportHandler({ supabase });
  }

  return productionHandler(req, res);
}
