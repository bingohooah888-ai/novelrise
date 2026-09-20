-- NOVELIGHT six-layer work classification foundation.
-- Official tags + author custom tags + future internal-search attribute ledger.
-- Existing single main genre and content-warning columns remain authoritative and unchanged.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260920221000'));

do $$
begin
  if to_regclass('public.novels') is null then
    raise exception 'NOVELIGHT novels foundation is required';
  end if;
end
$$;

create table public.official_tag_categories (
  id text primary key,
  display_name text not null unique,
  sort_order integer not null check (sort_order > 0)
);

create table public.official_tags (
  id text primary key check (id ~ '^[a-z0-9_]{2,64}$'),
  display_name text not null unique,
  category_id text not null references public.official_tag_categories(id) on delete restrict,
  sort_order integer not null check (sort_order > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.official_tag_aliases (
  tag_id text not null references public.official_tags(id) on delete cascade,
  alias text not null,
  alias_normalized text not null unique,
  primary key (tag_id, alias_normalized)
);

create table public.novel_official_tags (
  novel_id bigint not null references public.novels(id) on delete cascade,
  tag_id text not null references public.official_tags(id) on delete restrict,
  position smallint not null check (position between 1 and 10),
  created_at timestamptz not null default now(),
  primary key (novel_id, tag_id),
  unique (novel_id, position)
);

create table public.novel_custom_tags (
  novel_id bigint not null references public.novels(id) on delete cascade,
  tag_normalized text not null,
  display_name text not null check (
    char_length(display_name) between 1 and 30
    and display_name !~ '[<>\r\n\t]'
  ),
  position smallint not null check (position between 1 and 5),
  created_at timestamptz not null default now(),
  primary key (novel_id, tag_normalized),
  unique (novel_id, position)
);

create table public.novel_internal_search_attributes (
  novel_id bigint not null references public.novels(id) on delete cascade,
  attribute_key text not null check (attribute_key ~ '^[a-z0-9_]{2,80}$'),
  score numeric(5,4) check (score between 0 and 1),
  source text not null default 'future' check (source in ('future', 'rules', 'ai', 'operator')),
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (novel_id, attribute_key)
);

create index novel_official_tags_tag_novel_idx
  on public.novel_official_tags(tag_id, novel_id);
create index novel_custom_tags_novel_position_idx
  on public.novel_custom_tags(novel_id, position);

insert into public.official_tag_categories(id, display_name, sort_order)
values
  ('relationship', '恋愛・関係性', 1),
  ('webnovel', 'Web小説定番', 2),
  ('battle', '能力・バトル', 3),
  ('fantasy', 'ファンタジー', 4),
  ('dungeon_game', 'ダンジョン・ゲーム', 5),
  ('sf', 'SF', 6),
  ('mystery_crime', 'ミステリー・犯罪', 7),
  ('horror', 'ホラー', 8),
  ('school_youth', '学園・青春', 9),
  ('daily_work', '日常・仕事', 10),
  ('history', '歴史', 11),
  ('tone', '雰囲気', 12);

insert into public.official_tags(id, display_name, category_id, sort_order)
values
  ('yuri_gl', '百合／GL', 'relationship', 1),
  ('bl', 'BL', 'relationship', 2),
  ('relationship_003', '男女恋愛', 'relationship', 3),
  ('relationship_004', '恋愛なし', 'relationship', 4),
  ('relationship_005', 'ブロマンス', 'relationship', 5),
  ('relationship_006', '友情', 'relationship', 6),
  ('relationship_007', '相棒／バディ', 'relationship', 7),
  ('relationship_008', '師弟', 'relationship', 8),
  ('relationship_009', '主従', 'relationship', 9),
  ('relationship_010', '幼馴染', 'relationship', 10),
  ('relationship_011', '先輩後輩', 'relationship', 11),
  ('relationship_012', '年の差', 'relationship', 12),
  ('relationship_013', '身分差', 'relationship', 13),
  ('relationship_014', '異種族恋愛', 'relationship', 14),
  ('relationship_015', '敵同士', 'relationship', 15),
  ('relationship_016', 'ライバル', 'relationship', 16),
  ('relationship_017', '再会', 'relationship', 17),
  ('relationship_018', '初恋', 'relationship', 18),
  ('relationship_019', '片思い', 'relationship', 19),
  ('relationship_020', '両片思い', 'relationship', 20),
  ('relationship_021', 'すれ違い', 'relationship', 21),
  ('relationship_022', '三角関係', 'relationship', 22),
  ('relationship_023', '秘密の恋', 'relationship', 23),
  ('relationship_024', '政略結婚', 'relationship', 24),
  ('relationship_025', '契約結婚', 'relationship', 25),
  ('relationship_026', '偽装恋人', 'relationship', 26),
  ('relationship_027', '婚約', 'relationship', 27),
  ('relationship_028', '婚約破棄', 'relationship', 28),
  ('relationship_029', '復縁', 'relationship', 29),
  ('relationship_030', '溺愛', 'relationship', 30),
  ('relationship_031', '執着', 'relationship', 31),
  ('relationship_032', '一途', 'relationship', 32),
  ('relationship_033', 'ハーレム', 'relationship', 33),
  ('relationship_034', '逆ハーレム', 'relationship', 34),
  ('relationship_035', '甘々', 'relationship', 35),
  ('relationship_036', 'じれじれ', 'relationship', 36),
  ('relationship_037', 'オフィスラブ', 'relationship', 37),
  ('webnovel_001', '異世界転生', 'webnovel', 1),
  ('webnovel_002', '異世界転移', 'webnovel', 2),
  ('webnovel_003', '現地人主人公', 'webnovel', 3),
  ('webnovel_004', 'ゲーム世界転生', 'webnovel', 4),
  ('webnovel_005', '小説世界転生', 'webnovel', 5),
  ('webnovel_006', '乙女ゲーム', 'webnovel', 6),
  ('webnovel_007', '悪役令嬢', 'webnovel', 7),
  ('webnovel_008', '悪役令息', 'webnovel', 8),
  ('webnovel_009', 'モブ転生', 'webnovel', 9),
  ('webnovel_010', '人外転生', 'webnovel', 10),
  ('ts_gender_swap', 'TS／性別転換', 'webnovel', 11),
  ('webnovel_012', '入れ替わり', 'webnovel', 12),
  ('webnovel_013', '憑依', 'webnovel', 13),
  ('webnovel_014', '前世', 'webnovel', 14),
  ('webnovel_015', '召喚', 'webnovel', 15),
  ('webnovel_016', '勇者召喚', 'webnovel', 16),
  ('webnovel_017', 'クラス転移', 'webnovel', 17),
  ('webnovel_018', '追放', 'webnovel', 18),
  ('webnovel_019', 'ざまぁ', 'webnovel', 19),
  ('webnovel_020', 'もう遅い', 'webnovel', 20),
  ('webnovel_021', '成り上がり', 'webnovel', 21),
  ('webnovel_022', '下剋上', 'webnovel', 22),
  ('webnovel_023', 'スローライフ', 'webnovel', 23),
  ('webnovel_024', '内政', 'webnovel', 24),
  ('webnovel_025', '領地経営', 'webnovel', 25),
  ('webnovel_026', '建国', 'webnovel', 26),
  ('webnovel_027', '開拓', 'webnovel', 27),
  ('webnovel_028', '生産', 'webnovel', 28),
  ('webnovel_029', '料理', 'webnovel', 29),
  ('webnovel_030', '異世界通販', 'webnovel', 30),
  ('webnovel_031', 'もふもふ', 'webnovel', 31),
  ('webnovel_032', 'テイマー', 'webnovel', 32),
  ('webnovel_033', '勘違い', 'webnovel', 33),
  ('webnovel_034', '正体隠し', 'webnovel', 34),
  ('webnovel_035', '身分隠し', 'webnovel', 35),
  ('webnovel_036', '実力隠し', 'webnovel', 36),
  ('battle_001', 'バトル', 'battle', 1),
  ('battle_002', '能力バトル', 'battle', 2),
  ('battle_003', '異能力', 'battle', 3),
  ('battle_004', '魔法バトル', 'battle', 4),
  ('battle_005', '剣戟', 'battle', 5),
  ('battle_006', '格闘', 'battle', 6),
  ('battle_007', '銃撃戦', 'battle', 7),
  ('battle_008', '頭脳戦', 'battle', 8),
  ('battle_009', '心理戦', 'battle', 9),
  ('battle_010', 'デスゲーム', 'battle', 10),
  ('battle_011', 'サバイバル', 'battle', 11),
  ('battle_012', 'トーナメント', 'battle', 12),
  ('battle_013', '決闘', 'battle', 13),
  ('battle_014', '修行', 'battle', 14),
  ('battle_015', '成長', 'battle', 15),
  ('battle_016', '覚醒', 'battle', 16),
  ('battle_017', '無双', 'battle', 17),
  ('battle_018', 'チート', 'battle', 18),
  ('battle_019', '最強主人公', 'battle', 19),
  ('battle_020', '最弱から最強', 'battle', 20),
  ('battle_021', '復讐', 'battle', 21),
  ('fantasy_001', '剣と魔法', 'fantasy', 1),
  ('fantasy_002', '魔法', 'fantasy', 2),
  ('fantasy_003', '魔術', 'fantasy', 3),
  ('fantasy_004', '呪術', 'fantasy', 4),
  ('fantasy_005', '錬金術', 'fantasy', 5),
  ('fantasy_006', '精霊', 'fantasy', 6),
  ('fantasy_007', '妖精', 'fantasy', 7),
  ('fantasy_008', '神話', 'fantasy', 8),
  ('fantasy_009', '天使', 'fantasy', 9),
  ('fantasy_010', '悪魔', 'fantasy', 10),
  ('fantasy_011', '妖怪', 'fantasy', 11),
  ('fantasy_012', '怪異', 'fantasy', 12),
  ('fantasy_013', 'ドラゴン', 'fantasy', 13),
  ('fantasy_014', '吸血鬼', 'fantasy', 14),
  ('fantasy_015', 'エルフ', 'fantasy', 15),
  ('fantasy_016', '獣人', 'fantasy', 16),
  ('fantasy_017', '魔族', 'fantasy', 17),
  ('fantasy_018', '人外', 'fantasy', 18),
  ('fantasy_019', 'モンスター', 'fantasy', 19),
  ('fantasy_020', 'アンデッド', 'fantasy', 20),
  ('fantasy_021', 'ダンジョン', 'fantasy', 21),
  ('fantasy_022', '迷宮', 'fantasy', 22),
  ('fantasy_023', 'ギルド', 'fantasy', 23),
  ('fantasy_024', '魔法学校', 'fantasy', 24),
  ('fantasy_025', '魔法少女', 'fantasy', 25),
  ('fantasy_026', '使い魔', 'fantasy', 26),
  ('fantasy_027', '魔道具', 'fantasy', 27),
  ('fantasy_028', '聖剣', 'fantasy', 28),
  ('fantasy_029', '魔剣', 'fantasy', 29),
  ('fantasy_030', '呪物', 'fantasy', 30),
  ('fantasy_031', '古代文明', 'fantasy', 31),
  ('fantasy_032', '王国', 'fantasy', 32),
  ('fantasy_033', '帝国', 'fantasy', 33),
  ('fantasy_034', '貴族社会', 'fantasy', 34),
  ('fantasy_035', '王宮', 'fantasy', 35),
  ('fantasy_036', '後宮', 'fantasy', 36),
  ('fantasy_037', '魔王', 'fantasy', 37),
  ('fantasy_038', '勇者', 'fantasy', 38),
  ('fantasy_039', '聖女', 'fantasy', 39),
  ('fantasy_040', '予言', 'fantasy', 40),
  ('dungeon_game_001', '現代ダンジョン', 'dungeon_game', 1),
  ('dungeon_game_002', 'ダンジョン探索', 'dungeon_game', 2),
  ('dungeon_game_003', 'ダンジョン攻略', 'dungeon_game', 3),
  ('dungeon_game_004', 'ダンジョン配信', 'dungeon_game', 4),
  ('dungeon_game_005', 'ダンジョン経営', 'dungeon_game', 5),
  ('dungeon_game_006', 'VRMMO', 'dungeon_game', 6),
  ('dungeon_game_007', 'MMORPG', 'dungeon_game', 7),
  ('dungeon_game_008', 'フルダイブ', 'dungeon_game', 8),
  ('dungeon_game_009', 'ゲーム世界', 'dungeon_game', 9),
  ('dungeon_game_010', 'ゲーム実況', 'dungeon_game', 10),
  ('dungeon_game_011', '配信', 'dungeon_game', 11),
  ('dungeon_game_012', '掲示板回', 'dungeon_game', 12),
  ('dungeon_game_013', 'NPC', 'dungeon_game', 13),
  ('dungeon_game_014', 'レベル', 'dungeon_game', 14),
  ('dungeon_game_015', 'スキル', 'dungeon_game', 15),
  ('dungeon_game_016', 'ステータス', 'dungeon_game', 16),
  ('sf_001', '近未来', 'sf', 1),
  ('sf_002', '遠未来', 'sf', 2),
  ('sf_003', 'サイバーパンク', 'sf', 3),
  ('sf_004', 'スチームパンク', 'sf', 4),
  ('sf_005', 'ポストアポカリプス', 'sf', 5),
  ('sf_006', 'ディストピア', 'sf', 6),
  ('sf_007', '宇宙', 'sf', 7),
  ('sf_008', '宇宙戦争', 'sf', 8),
  ('sf_009', '惑星開拓', 'sf', 9),
  ('sf_010', '異星人', 'sf', 10),
  ('sf_011', 'ファーストコンタクト', 'sf', 11),
  ('sf_012', 'ロボット', 'sf', 12),
  ('sf_013', '巨大ロボ', 'sf', 13),
  ('sf_014', 'アンドロイド', 'sf', 14),
  ('sf_015', 'AI', 'sf', 15),
  ('sf_016', '電脳世界', 'sf', 16),
  ('sf_017', '仮想世界', 'sf', 17),
  ('sf_018', 'サイボーグ', 'sf', 18),
  ('sf_019', 'タイムリープ', 'sf', 19),
  ('sf_020', 'タイムトラベル', 'sf', 20),
  ('sf_021', 'ループ', 'sf', 21),
  ('sf_022', 'パラレルワールド', 'sf', 22),
  ('sf_023', '世界線', 'sf', 23),
  ('mystery_crime_001', '推理', 'mystery_crime', 1),
  ('mystery_crime_002', '本格ミステリー', 'mystery_crime', 2),
  ('mystery_crime_003', '日常の謎', 'mystery_crime', 3),
  ('mystery_crime_004', '密室', 'mystery_crime', 4),
  ('mystery_crime_005', '殺人事件', 'mystery_crime', 5),
  ('mystery_crime_006', '連続殺人', 'mystery_crime', 6),
  ('mystery_crime_007', '犯人探し', 'mystery_crime', 7),
  ('mystery_crime_008', '探偵', 'mystery_crime', 8),
  ('mystery_crime_009', '警察', 'mystery_crime', 9),
  ('mystery_crime_010', '犯罪', 'mystery_crime', 10),
  ('mystery_crime_011', '裏社会', 'mystery_crime', 11),
  ('mystery_crime_012', 'マフィア', 'mystery_crime', 12),
  ('mystery_crime_013', 'ヤクザ', 'mystery_crime', 13),
  ('mystery_crime_014', '殺し屋', 'mystery_crime', 14),
  ('mystery_crime_015', '怪盗', 'mystery_crime', 15),
  ('mystery_crime_016', 'スパイ', 'mystery_crime', 16),
  ('mystery_crime_017', '潜入', 'mystery_crime', 17),
  ('mystery_crime_018', '逃亡', 'mystery_crime', 18),
  ('mystery_crime_019', '冤罪', 'mystery_crime', 19),
  ('mystery_crime_020', '法廷', 'mystery_crime', 20),
  ('mystery_crime_021', 'サスペンス', 'mystery_crime', 21),
  ('mystery_crime_022', 'ノワール', 'mystery_crime', 22),
  ('mystery_crime_023', 'どんでん返し', 'mystery_crime', 23),
  ('mystery_crime_024', '叙述トリック', 'mystery_crime', 24),
  ('horror_001', '怪談', 'horror', 1),
  ('horror_002', '心霊', 'horror', 2),
  ('horror_003', '幽霊', 'horror', 3),
  ('horror_004', '都市伝説', 'horror', 4),
  ('horror_007', '呪い', 'horror', 7),
  ('horror_009', '因習', 'horror', 9),
  ('horror_010', '土着信仰', 'horror', 10),
  ('horror_011', 'オカルト', 'horror', 11),
  ('horror_012', '悪霊', 'horror', 12),
  ('horror_013', 'ゾンビ', 'horror', 13),
  ('horror_014', 'パニック', 'horror', 14),
  ('horror_015', 'サバイバルホラー', 'horror', 15),
  ('horror_016', '心理ホラー', 'horror', 16),
  ('horror_017', 'ゴシック', 'horror', 17),
  ('horror_018', 'コズミックホラー', 'horror', 18),
  ('horror_019', '廃墟', 'horror', 19),
  ('horror_020', '学校の怪談', 'horror', 20),
  ('school_youth_001', '学園', 'school_youth', 1),
  ('school_youth_002', '寮生活', 'school_youth', 2),
  ('school_youth_003', '部活動', 'school_youth', 3),
  ('school_youth_004', '生徒会', 'school_youth', 4),
  ('school_youth_005', '青春', 'school_youth', 5),
  ('school_youth_006', '受験', 'school_youth', 6),
  ('school_youth_007', '不登校', 'school_youth', 7),
  ('school_youth_008', 'スクールカースト', 'school_youth', 8),
  ('school_youth_009', '放課後', 'school_youth', 9),
  ('school_youth_010', '文化祭', 'school_youth', 10),
  ('school_youth_011', '体育祭', 'school_youth', 11),
  ('school_youth_012', '修学旅行', 'school_youth', 12),
  ('school_youth_013', '青春群像劇', 'school_youth', 13),
  ('daily_work_001', '日常', 'daily_work', 1),
  ('daily_work_002', 'ほのぼの', 'daily_work', 2),
  ('daily_work_003', 'お仕事', 'daily_work', 3),
  ('daily_work_004', '社会人', 'daily_work', 4),
  ('daily_work_005', '会社', 'daily_work', 5),
  ('daily_work_006', 'ブラック企業', 'daily_work', 6),
  ('daily_work_007', '転職', 'daily_work', 7),
  ('daily_work_008', '起業', 'daily_work', 8),
  ('daily_work_009', '経営', 'daily_work', 9),
  ('daily_work_010', '店舗経営', 'daily_work', 10),
  ('daily_work_011', 'カフェ', 'daily_work', 11),
  ('daily_work_012', '宿屋', 'daily_work', 12),
  ('daily_work_013', '農業', 'daily_work', 13),
  ('daily_work_015', 'グルメ', 'daily_work', 15),
  ('daily_work_016', '職人', 'daily_work', 16),
  ('daily_work_017', 'ものづくり', 'daily_work', 17),
  ('daily_work_018', '医療', 'daily_work', 18),
  ('daily_work_019', '法律', 'daily_work', 19),
  ('daily_work_020', '芸能界', 'daily_work', 20),
  ('daily_work_021', 'アイドル', 'daily_work', 21),
  ('daily_work_022', '音楽', 'daily_work', 22),
  ('daily_work_023', 'バンド', 'daily_work', 23),
  ('daily_work_024', '演劇', 'daily_work', 24),
  ('daily_work_025', '配信者', 'daily_work', 25),
  ('daily_work_026', 'VTuber', 'daily_work', 26),
  ('daily_work_027', 'SNS', 'daily_work', 27),
  ('daily_work_028', '小説家', 'daily_work', 28),
  ('daily_work_029', '漫画家', 'daily_work', 29),
  ('history_001', '戦国', 'history', 1),
  ('history_002', '江戸', 'history', 2),
  ('history_003', '幕末', 'history', 3),
  ('history_004', '明治', 'history', 4),
  ('history_005', '大正', 'history', 5),
  ('history_006', '昭和', 'history', 6),
  ('history_007', '平安', 'history', 7),
  ('history_008', '鎌倉', 'history', 8),
  ('history_009', '武士', 'history', 9),
  ('history_010', '忍者', 'history', 10),
  ('history_011', '新選組', 'history', 11),
  ('history_012', '架空戦記', 'history', 12),
  ('history_013', '歴史改変', 'history', 13),
  ('history_014', '中世', 'history', 14),
  ('history_015', '古代', 'history', 15),
  ('history_016', '三国志', 'history', 16),
  ('history_017', '和風ファンタジー', 'history', 17),
  ('history_018', '中華風ファンタジー', 'history', 18),
  ('tone_001', 'コメディ', 'tone', 1),
  ('tone_002', 'ギャグ', 'tone', 2),
  ('tone_003', 'シリアス', 'tone', 3),
  ('tone_004', 'ダーク', 'tone', 4),
  ('tone_005', 'ダークファンタジー', 'tone', 5),
  ('tone_007', '癒やし', 'tone', 7),
  ('tone_008', 'ハートフル', 'tone', 8),
  ('tone_009', '感動', 'tone', 9),
  ('tone_010', '切ない', 'tone', 10),
  ('tone_011', '爽快', 'tone', 11),
  ('tone_012', '熱い', 'tone', 12),
  ('tone_013', '王道', 'tone', 13),
  ('tone_014', '重厚', 'tone', 14),
  ('tone_015', '不穏', 'tone', 15),
  ('tone_016', '鬱展開', 'tone', 16),
  ('tone_017', '胸糞', 'tone', 17),
  ('tone_018', '救いあり', 'tone', 18),
  ('tone_019', '救いなし', 'tone', 19),
  ('tone_020', 'ハッピーエンド', 'tone', 20),
  ('tone_021', 'バッドエンド', 'tone', 21),
  ('tone_022', 'メリーバッドエンド', 'tone', 22),
  ('tone_023', '大団円', 'tone', 23),
  ('tone_024', 'シュール', 'tone', 24);

insert into public.official_tag_aliases(tag_id, alias, alias_normalized)
values
  ('yuri_gl', '百合／GL', '百合/gl'),
  ('yuri_gl', '百合', '百合'),
  ('yuri_gl', 'GL', 'gl'),
  ('yuri_gl', 'ガールズラブ', 'ガールズラブ'),
  ('bl', 'BL', 'bl'),
  ('bl', 'ボーイズラブ', 'ボーイズラブ'),
  ('relationship_003', '男女恋愛', '男女恋愛'),
  ('relationship_004', '恋愛なし', '恋愛なし'),
  ('relationship_005', 'ブロマンス', 'ブロマンス'),
  ('relationship_006', '友情', '友情'),
  ('relationship_007', '相棒／バディ', '相棒/バディ'),
  ('relationship_008', '師弟', '師弟'),
  ('relationship_009', '主従', '主従'),
  ('relationship_010', '幼馴染', '幼馴染'),
  ('relationship_011', '先輩後輩', '先輩後輩'),
  ('relationship_012', '年の差', '年の差'),
  ('relationship_013', '身分差', '身分差'),
  ('relationship_014', '異種族恋愛', '異種族恋愛'),
  ('relationship_015', '敵同士', '敵同士'),
  ('relationship_016', 'ライバル', 'ライバル'),
  ('relationship_017', '再会', '再会'),
  ('relationship_018', '初恋', '初恋'),
  ('relationship_019', '片思い', '片思い'),
  ('relationship_020', '両片思い', '両片思い'),
  ('relationship_021', 'すれ違い', 'すれ違い'),
  ('relationship_022', '三角関係', '三角関係'),
  ('relationship_023', '秘密の恋', '秘密の恋'),
  ('relationship_024', '政略結婚', '政略結婚'),
  ('relationship_025', '契約結婚', '契約結婚'),
  ('relationship_026', '偽装恋人', '偽装恋人'),
  ('relationship_027', '婚約', '婚約'),
  ('relationship_028', '婚約破棄', '婚約破棄'),
  ('relationship_029', '復縁', '復縁'),
  ('relationship_030', '溺愛', '溺愛'),
  ('relationship_031', '執着', '執着'),
  ('relationship_032', '一途', '一途'),
  ('relationship_033', 'ハーレム', 'ハーレム'),
  ('relationship_034', '逆ハーレム', '逆ハーレム'),
  ('relationship_035', '甘々', '甘々'),
  ('relationship_036', 'じれじれ', 'じれじれ'),
  ('relationship_037', 'オフィスラブ', 'オフィスラブ'),
  ('webnovel_001', '異世界転生', '異世界転生'),
  ('webnovel_002', '異世界転移', '異世界転移'),
  ('webnovel_003', '現地人主人公', '現地人主人公'),
  ('webnovel_004', 'ゲーム世界転生', 'ゲーム世界転生'),
  ('webnovel_005', '小説世界転生', '小説世界転生'),
  ('webnovel_006', '乙女ゲーム', '乙女ゲーム'),
  ('webnovel_007', '悪役令嬢', '悪役令嬢'),
  ('webnovel_008', '悪役令息', '悪役令息'),
  ('webnovel_009', 'モブ転生', 'モブ転生'),
  ('webnovel_010', '人外転生', '人外転生'),
  ('ts_gender_swap', 'TS／性別転換', 'ts/性別転換'),
  ('ts_gender_swap', 'TS', 'ts'),
  ('ts_gender_swap', 'TSF', 'tsf'),
  ('ts_gender_swap', '性転換', '性転換'),
  ('ts_gender_swap', '性別転換', '性別転換'),
  ('webnovel_012', '入れ替わり', '入れ替わり'),
  ('webnovel_013', '憑依', '憑依'),
  ('webnovel_014', '前世', '前世'),
  ('webnovel_015', '召喚', '召喚'),
  ('webnovel_016', '勇者召喚', '勇者召喚'),
  ('webnovel_017', 'クラス転移', 'クラス転移'),
  ('webnovel_018', '追放', '追放'),
  ('webnovel_019', 'ざまぁ', 'ざまぁ'),
  ('webnovel_020', 'もう遅い', 'もう遅い'),
  ('webnovel_021', '成り上がり', '成り上がり'),
  ('webnovel_022', '下剋上', '下剋上'),
  ('webnovel_023', 'スローライフ', 'スローライフ'),
  ('webnovel_024', '内政', '内政'),
  ('webnovel_025', '領地経営', '領地経営'),
  ('webnovel_026', '建国', '建国'),
  ('webnovel_027', '開拓', '開拓'),
  ('webnovel_028', '生産', '生産'),
  ('webnovel_029', '料理', '料理'),
  ('webnovel_030', '異世界通販', '異世界通販'),
  ('webnovel_031', 'もふもふ', 'もふもふ'),
  ('webnovel_032', 'テイマー', 'テイマー'),
  ('webnovel_033', '勘違い', '勘違い'),
  ('webnovel_034', '正体隠し', '正体隠し'),
  ('webnovel_035', '身分隠し', '身分隠し'),
  ('webnovel_036', '実力隠し', '実力隠し'),
  ('battle_001', 'バトル', 'バトル'),
  ('battle_002', '能力バトル', '能力バトル'),
  ('battle_003', '異能力', '異能力'),
  ('battle_004', '魔法バトル', '魔法バトル'),
  ('battle_005', '剣戟', '剣戟'),
  ('battle_006', '格闘', '格闘'),
  ('battle_007', '銃撃戦', '銃撃戦'),
  ('battle_008', '頭脳戦', '頭脳戦'),
  ('battle_009', '心理戦', '心理戦'),
  ('battle_010', 'デスゲーム', 'デスゲーム'),
  ('battle_011', 'サバイバル', 'サバイバル'),
  ('battle_012', 'トーナメント', 'トーナメント'),
  ('battle_013', '決闘', '決闘'),
  ('battle_014', '修行', '修行'),
  ('battle_015', '成長', '成長'),
  ('battle_016', '覚醒', '覚醒'),
  ('battle_017', '無双', '無双'),
  ('battle_018', 'チート', 'チート'),
  ('battle_019', '最強主人公', '最強主人公'),
  ('battle_020', '最弱から最強', '最弱から最強'),
  ('battle_021', '復讐', '復讐'),
  ('fantasy_001', '剣と魔法', '剣と魔法'),
  ('fantasy_002', '魔法', '魔法'),
  ('fantasy_003', '魔術', '魔術'),
  ('fantasy_004', '呪術', '呪術'),
  ('fantasy_005', '錬金術', '錬金術'),
  ('fantasy_006', '精霊', '精霊'),
  ('fantasy_007', '妖精', '妖精'),
  ('fantasy_008', '神話', '神話'),
  ('fantasy_009', '天使', '天使'),
  ('fantasy_010', '悪魔', '悪魔'),
  ('fantasy_011', '妖怪', '妖怪'),
  ('fantasy_012', '怪異', '怪異'),
  ('fantasy_013', 'ドラゴン', 'ドラゴン'),
  ('fantasy_014', '吸血鬼', '吸血鬼'),
  ('fantasy_015', 'エルフ', 'エルフ'),
  ('fantasy_016', '獣人', '獣人'),
  ('fantasy_017', '魔族', '魔族'),
  ('fantasy_018', '人外', '人外'),
  ('fantasy_019', 'モンスター', 'モンスター'),
  ('fantasy_020', 'アンデッド', 'アンデッド'),
  ('fantasy_021', 'ダンジョン', 'ダンジョン'),
  ('fantasy_022', '迷宮', '迷宮'),
  ('fantasy_023', 'ギルド', 'ギルド'),
  ('fantasy_024', '魔法学校', '魔法学校'),
  ('fantasy_025', '魔法少女', '魔法少女'),
  ('fantasy_026', '使い魔', '使い魔'),
  ('fantasy_027', '魔道具', '魔道具'),
  ('fantasy_028', '聖剣', '聖剣'),
  ('fantasy_029', '魔剣', '魔剣'),
  ('fantasy_030', '呪物', '呪物'),
  ('fantasy_031', '古代文明', '古代文明'),
  ('fantasy_032', '王国', '王国'),
  ('fantasy_033', '帝国', '帝国'),
  ('fantasy_034', '貴族社会', '貴族社会'),
  ('fantasy_035', '王宮', '王宮'),
  ('fantasy_036', '後宮', '後宮'),
  ('fantasy_037', '魔王', '魔王'),
  ('fantasy_038', '勇者', '勇者'),
  ('fantasy_039', '聖女', '聖女'),
  ('fantasy_040', '予言', '予言'),
  ('dungeon_game_001', '現代ダンジョン', '現代ダンジョン'),
  ('dungeon_game_002', 'ダンジョン探索', 'ダンジョン探索'),
  ('dungeon_game_003', 'ダンジョン攻略', 'ダンジョン攻略'),
  ('dungeon_game_004', 'ダンジョン配信', 'ダンジョン配信'),
  ('dungeon_game_005', 'ダンジョン経営', 'ダンジョン経営'),
  ('dungeon_game_006', 'VRMMO', 'vrmmo'),
  ('dungeon_game_007', 'MMORPG', 'mmorpg'),
  ('dungeon_game_008', 'フルダイブ', 'フルダイブ'),
  ('dungeon_game_009', 'ゲーム世界', 'ゲーム世界'),
  ('dungeon_game_010', 'ゲーム実況', 'ゲーム実況'),
  ('dungeon_game_011', '配信', '配信'),
  ('dungeon_game_012', '掲示板回', '掲示板回'),
  ('dungeon_game_013', 'NPC', 'npc'),
  ('dungeon_game_014', 'レベル', 'レベル'),
  ('dungeon_game_015', 'スキル', 'スキル'),
  ('dungeon_game_016', 'ステータス', 'ステータス'),
  ('sf_001', '近未来', '近未来'),
  ('sf_002', '遠未来', '遠未来'),
  ('sf_003', 'サイバーパンク', 'サイバーパンク'),
  ('sf_004', 'スチームパンク', 'スチームパンク'),
  ('sf_005', 'ポストアポカリプス', 'ポストアポカリプス'),
  ('sf_006', 'ディストピア', 'ディストピア'),
  ('sf_007', '宇宙', '宇宙'),
  ('sf_008', '宇宙戦争', '宇宙戦争'),
  ('sf_009', '惑星開拓', '惑星開拓'),
  ('sf_010', '異星人', '異星人'),
  ('sf_011', 'ファーストコンタクト', 'ファーストコンタクト'),
  ('sf_012', 'ロボット', 'ロボット'),
  ('sf_013', '巨大ロボ', '巨大ロボ'),
  ('sf_014', 'アンドロイド', 'アンドロイド'),
  ('sf_015', 'AI', 'ai'),
  ('sf_016', '電脳世界', '電脳世界'),
  ('sf_017', '仮想世界', '仮想世界'),
  ('sf_018', 'サイボーグ', 'サイボーグ'),
  ('sf_019', 'タイムリープ', 'タイムリープ'),
  ('sf_020', 'タイムトラベル', 'タイムトラベル'),
  ('sf_021', 'ループ', 'ループ'),
  ('sf_022', 'パラレルワールド', 'パラレルワールド'),
  ('sf_023', '世界線', '世界線'),
  ('mystery_crime_001', '推理', '推理'),
  ('mystery_crime_002', '本格ミステリー', '本格ミステリー'),
  ('mystery_crime_003', '日常の謎', '日常の謎'),
  ('mystery_crime_004', '密室', '密室'),
  ('mystery_crime_005', '殺人事件', '殺人事件'),
  ('mystery_crime_006', '連続殺人', '連続殺人'),
  ('mystery_crime_007', '犯人探し', '犯人探し'),
  ('mystery_crime_008', '探偵', '探偵'),
  ('mystery_crime_009', '警察', '警察'),
  ('mystery_crime_010', '犯罪', '犯罪'),
  ('mystery_crime_011', '裏社会', '裏社会'),
  ('mystery_crime_012', 'マフィア', 'マフィア'),
  ('mystery_crime_013', 'ヤクザ', 'ヤクザ'),
  ('mystery_crime_014', '殺し屋', '殺し屋'),
  ('mystery_crime_015', '怪盗', '怪盗'),
  ('mystery_crime_016', 'スパイ', 'スパイ'),
  ('mystery_crime_017', '潜入', '潜入'),
  ('mystery_crime_018', '逃亡', '逃亡'),
  ('mystery_crime_019', '冤罪', '冤罪'),
  ('mystery_crime_020', '法廷', '法廷'),
  ('mystery_crime_021', 'サスペンス', 'サスペンス'),
  ('mystery_crime_022', 'ノワール', 'ノワール'),
  ('mystery_crime_023', 'どんでん返し', 'どんでん返し'),
  ('mystery_crime_024', '叙述トリック', '叙述トリック'),
  ('horror_001', '怪談', '怪談'),
  ('horror_002', '心霊', '心霊'),
  ('horror_003', '幽霊', '幽霊'),
  ('horror_004', '都市伝説', '都市伝説'),
  ('horror_007', '呪い', '呪い'),
  ('horror_009', '因習', '因習'),
  ('horror_010', '土着信仰', '土着信仰'),
  ('horror_011', 'オカルト', 'オカルト'),
  ('horror_012', '悪霊', '悪霊'),
  ('horror_013', 'ゾンビ', 'ゾンビ'),
  ('horror_014', 'パニック', 'パニック'),
  ('horror_015', 'サバイバルホラー', 'サバイバルホラー'),
  ('horror_016', '心理ホラー', '心理ホラー'),
  ('horror_017', 'ゴシック', 'ゴシック'),
  ('horror_018', 'コズミックホラー', 'コズミックホラー'),
  ('horror_019', '廃墟', '廃墟'),
  ('horror_020', '学校の怪談', '学校の怪談'),
  ('school_youth_001', '学園', '学園'),
  ('school_youth_002', '寮生活', '寮生活'),
  ('school_youth_003', '部活動', '部活動'),
  ('school_youth_004', '生徒会', '生徒会'),
  ('school_youth_005', '青春', '青春'),
  ('school_youth_006', '受験', '受験'),
  ('school_youth_007', '不登校', '不登校'),
  ('school_youth_008', 'スクールカースト', 'スクールカースト'),
  ('school_youth_009', '放課後', '放課後'),
  ('school_youth_010', '文化祭', '文化祭'),
  ('school_youth_011', '体育祭', '体育祭'),
  ('school_youth_012', '修学旅行', '修学旅行'),
  ('school_youth_013', '青春群像劇', '青春群像劇'),
  ('daily_work_001', '日常', '日常'),
  ('daily_work_002', 'ほのぼの', 'ほのぼの'),
  ('daily_work_003', 'お仕事', 'お仕事'),
  ('daily_work_004', '社会人', '社会人'),
  ('daily_work_005', '会社', '会社'),
  ('daily_work_006', 'ブラック企業', 'ブラック企業'),
  ('daily_work_007', '転職', '転職'),
  ('daily_work_008', '起業', '起業'),
  ('daily_work_009', '経営', '経営'),
  ('daily_work_010', '店舗経営', '店舗経営'),
  ('daily_work_011', 'カフェ', 'カフェ'),
  ('daily_work_012', '宿屋', '宿屋'),
  ('daily_work_013', '農業', '農業'),
  ('daily_work_015', 'グルメ', 'グルメ'),
  ('daily_work_016', '職人', '職人'),
  ('daily_work_017', 'ものづくり', 'ものづくり'),
  ('daily_work_018', '医療', '医療'),
  ('daily_work_019', '法律', '法律'),
  ('daily_work_020', '芸能界', '芸能界'),
  ('daily_work_021', 'アイドル', 'アイドル'),
  ('daily_work_022', '音楽', '音楽'),
  ('daily_work_023', 'バンド', 'バンド'),
  ('daily_work_024', '演劇', '演劇'),
  ('daily_work_025', '配信者', '配信者'),
  ('daily_work_026', 'VTuber', 'vtuber'),
  ('daily_work_027', 'SNS', 'sns'),
  ('daily_work_028', '小説家', '小説家'),
  ('daily_work_029', '漫画家', '漫画家'),
  ('history_001', '戦国', '戦国'),
  ('history_002', '江戸', '江戸'),
  ('history_003', '幕末', '幕末'),
  ('history_004', '明治', '明治'),
  ('history_005', '大正', '大正'),
  ('history_006', '昭和', '昭和'),
  ('history_007', '平安', '平安'),
  ('history_008', '鎌倉', '鎌倉'),
  ('history_009', '武士', '武士'),
  ('history_010', '忍者', '忍者'),
  ('history_011', '新選組', '新選組'),
  ('history_012', '架空戦記', '架空戦記'),
  ('history_013', '歴史改変', '歴史改変'),
  ('history_014', '中世', '中世'),
  ('history_015', '古代', '古代'),
  ('history_016', '三国志', '三国志'),
  ('history_017', '和風ファンタジー', '和風ファンタジー'),
  ('history_018', '中華風ファンタジー', '中華風ファンタジー'),
  ('tone_001', 'コメディ', 'コメディ'),
  ('tone_002', 'ギャグ', 'ギャグ'),
  ('tone_003', 'シリアス', 'シリアス'),
  ('tone_004', 'ダーク', 'ダーク'),
  ('tone_005', 'ダークファンタジー', 'ダークファンタジー'),
  ('tone_007', '癒やし', '癒やし'),
  ('tone_008', 'ハートフル', 'ハートフル'),
  ('tone_009', '感動', '感動'),
  ('tone_010', '切ない', '切ない'),
  ('tone_011', '爽快', '爽快'),
  ('tone_012', '熱い', '熱い'),
  ('tone_013', '王道', '王道'),
  ('tone_014', '重厚', '重厚'),
  ('tone_015', '不穏', '不穏'),
  ('tone_016', '鬱展開', '鬱展開'),
  ('tone_017', '胸糞', '胸糞'),
  ('tone_018', '救いあり', '救いあり'),
  ('tone_019', '救いなし', '救いなし'),
  ('tone_020', 'ハッピーエンド', 'ハッピーエンド'),
  ('tone_021', 'バッドエンド', 'バッドエンド'),
  ('tone_022', 'メリーバッドエンド', 'メリーバッドエンド'),
  ('tone_023', '大団円', '大団円'),
  ('tone_024', 'シュール', 'シュール');

alter table public.official_tag_categories enable row level security;
alter table public.official_tags enable row level security;
alter table public.official_tag_aliases enable row level security;
alter table public.novel_official_tags enable row level security;
alter table public.novel_custom_tags enable row level security;
alter table public.novel_internal_search_attributes enable row level security;

create policy novelight_official_tag_categories_public_read
on public.official_tag_categories for select to anon, authenticated using (true);

create policy novelight_official_tags_public_read
on public.official_tags for select to anon, authenticated using (is_active);

create policy novelight_official_tag_aliases_public_read
on public.official_tag_aliases for select to anon, authenticated
using (exists (
  select 1 from public.official_tags t
  where t.id = official_tag_aliases.tag_id and t.is_active
));

create policy novelight_novel_official_tags_visible_read
on public.novel_official_tags for select to anon, authenticated
using (exists (
  select 1 from public.novels n
  where n.id = novel_official_tags.novel_id
    and (
      n.status = 'published'
      or ((select auth.uid()) is not null and n.user_id = (select auth.uid()))
    )
));

create policy novelight_novel_custom_tags_visible_read
on public.novel_custom_tags for select to anon, authenticated
using (exists (
  select 1 from public.novels n
  where n.id = novel_custom_tags.novel_id
    and (
      n.status = 'published'
      or ((select auth.uid()) is not null and n.user_id = (select auth.uid()))
    )
));

revoke all on table public.official_tag_categories from public, anon, authenticated;
revoke all on table public.official_tags from public, anon, authenticated;
revoke all on table public.official_tag_aliases from public, anon, authenticated;
revoke all on table public.novel_official_tags from public, anon, authenticated;
revoke all on table public.novel_custom_tags from public, anon, authenticated;
revoke all on table public.novel_internal_search_attributes from public, anon, authenticated;

grant select on table public.official_tag_categories to anon, authenticated;
grant select on table public.official_tags to anon, authenticated;
grant select on table public.official_tag_aliases to anon, authenticated;
grant select on table public.novel_official_tags to anon, authenticated;
grant select on table public.novel_custom_tags to anon, authenticated;

create or replace function public.novelight_normalize_custom_tag(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.lower(
    pg_catalog.regexp_replace(
      pg_catalog.btrim(coalesce(p_value, '')),
      '[[:space:]]+',
      ' ',
      'g'
    )
  )
$$;

create or replace function public.novelight_official_tag_catalog()
returns table (
  id text,
  display_name text,
  category_id text,
  category_name text,
  category_sort integer,
  tag_sort integer,
  aliases text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.id,
    t.display_name,
    t.category_id,
    c.display_name as category_name,
    c.sort_order as category_sort,
    t.sort_order as tag_sort,
    coalesce(
      array_agg(a.alias order by a.alias_normalized)
        filter (where a.alias is not null),
      '{}'::text[]
    ) as aliases
  from public.official_tags t
  join public.official_tag_categories c on c.id = t.category_id
  left join public.official_tag_aliases a on a.tag_id = t.id
  where t.is_active
  group by t.id, t.display_name, t.category_id, c.display_name, c.sort_order, t.sort_order
  order by c.sort_order, t.sort_order, t.id
$$;

create or replace function public.novelight_set_novel_tags(
  p_novel_id bigint,
  p_official_tag_ids text[] default '{}'::text[],
  p_custom_tags text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_owner uuid;
  v_official_count integer;
  v_official_distinct integer;
  v_custom_count integer;
  v_custom_distinct integer;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_novel_id is null or p_novel_id <= 0 then
    raise exception using errcode = '22023', message = 'Invalid novel';
  end if;

  select n.user_id into v_owner
  from public.novels n
  where n.id = p_novel_id
  for update;

  if not found then
    raise exception using errcode = '23514', message = 'NOVEL_NOT_FOUND';
  end if;
  if v_owner <> v_uid then
    raise exception using errcode = '42501', message = 'NOVEL_TAG_OWNER_REQUIRED';
  end if;

  select count(*)::integer, count(distinct x.tag_id)::integer
    into v_official_count, v_official_distinct
  from unnest(coalesce(p_official_tag_ids, '{}'::text[])) as x(tag_id);

  if v_official_count > 10 then
    raise exception using errcode = '23514', message = 'OFFICIAL_TAG_LIMIT_10';
  end if;
  if v_official_count <> v_official_distinct then
    raise exception using errcode = '23514', message = 'DUPLICATE_OFFICIAL_TAG';
  end if;
  if exists (
    select 1
    from unnest(coalesce(p_official_tag_ids, '{}'::text[])) as x(tag_id)
    left join public.official_tags t on t.id = x.tag_id and t.is_active
    where t.id is null
  ) then
    raise exception using errcode = '23514', message = 'UNKNOWN_OFFICIAL_TAG';
  end if;

  with normalized as (
    select
      ord::integer as position,
      pg_catalog.regexp_replace(
        pg_catalog.btrim(raw_tag),
        '[[:space:]]+',
        ' ',
        'g'
      ) as display_name,
      public.novelight_normalize_custom_tag(raw_tag) as normalized_name
    from unnest(coalesce(p_custom_tags, '{}'::text[]))
      with ordinality as x(raw_tag, ord)
  )
  select count(*)::integer, count(distinct normalized_name)::integer
    into v_custom_count, v_custom_distinct
  from normalized;

  if v_custom_count > 5 then
    raise exception using errcode = '23514', message = 'CUSTOM_TAG_LIMIT_5';
  end if;
  if v_custom_count <> v_custom_distinct then
    raise exception using errcode = '23514', message = 'DUPLICATE_CUSTOM_TAG';
  end if;
  if exists (
    select 1
    from unnest(coalesce(p_custom_tags, '{}'::text[])) as x(raw_tag)
    cross join lateral (
      select
        pg_catalog.regexp_replace(pg_catalog.btrim(x.raw_tag), '[[:space:]]+', ' ', 'g') as display_name,
        public.novelight_normalize_custom_tag(x.raw_tag) as normalized_name
    ) normalized
    where normalized.display_name = ''
       or char_length(normalized.display_name) > 30
       or normalized.display_name ~ '[<>\r\n\t]'
       or exists (
         select 1 from public.official_tag_aliases a
         where a.alias_normalized = normalized.normalized_name
       )
  ) then
    raise exception using errcode = '23514', message = 'INVALID_OR_OFFICIAL_ALIAS_CUSTOM_TAG';
  end if;

  delete from public.novel_official_tags where novel_id = p_novel_id;
  insert into public.novel_official_tags(novel_id, tag_id, position)
  select p_novel_id, x.tag_id, x.ord::smallint
  from unnest(coalesce(p_official_tag_ids, '{}'::text[]))
    with ordinality as x(tag_id, ord);

  delete from public.novel_custom_tags where novel_id = p_novel_id;
  insert into public.novel_custom_tags(novel_id, tag_normalized, display_name, position)
  select
    p_novel_id,
    public.novelight_normalize_custom_tag(x.raw_tag),
    pg_catalog.regexp_replace(pg_catalog.btrim(x.raw_tag), '[[:space:]]+', ' ', 'g'),
    x.ord::smallint
  from unnest(coalesce(p_custom_tags, '{}'::text[]))
    with ordinality as x(raw_tag, ord);

  return pg_catalog.jsonb_build_object(
    'novel_id', p_novel_id,
    'official_tag_count', v_official_count,
    'custom_tag_count', v_custom_count
  );
end
$$;

create or replace function public.novelight_novel_tag_labels(p_novel_ids bigint[])
returns table (
  novel_id bigint,
  tag_type text,
  tag_id text,
  display_name text,
  category_id text,
  tag_position integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with requested as (
    select distinct id
    from unnest(coalesce(p_novel_ids, '{}'::bigint[])) as x(id)
    where id is not null and id > 0
    limit 100
  ), visible as (
    select n.id
    from public.novels n
    join requested r on r.id = n.id
    where n.status = 'published'
       or ((select auth.uid()) is not null and n.user_id = (select auth.uid()))
  )
  select
    nt.novel_id,
    'official'::text,
    t.id,
    t.display_name,
    t.category_id,
    nt.position::integer
  from public.novel_official_tags nt
  join visible v on v.id = nt.novel_id
  join public.official_tags t on t.id = nt.tag_id and t.is_active
  union all
  select
    ct.novel_id,
    'custom'::text,
    null::text,
    ct.display_name,
    null::text,
    ct.position::integer
  from public.novel_custom_tags ct
  join visible v on v.id = ct.novel_id
  order by 1, 2 desc, 6, 4
$$;

create or replace function public.novelight_neutral_search_v2(
  p_keyword text default null,
  p_genre text default null,
  p_official_tag_ids text[] default '{}'::text[],
  p_sort text default 'new',
  p_limit integer default 24,
  p_offset integer default 0
)
returns table (
  novel_id text,
  title text,
  genre text,
  description text,
  created_at timestamptz,
  pv bigint,
  favorite_count bigint,
  official_tag_ids text[],
  official_tag_names text[],
  custom_tag_names text[],
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with requested_tags as (
    select distinct pg_catalog.btrim(tag_id) as tag_id
    from unnest(coalesce(p_official_tag_ids, '{}'::text[])) as x(tag_id)
    where nullif(pg_catalog.btrim(tag_id), '') is not null
    limit 10
  ), requested_tag_count as (
    select count(*)::integer as value from requested_tags
  ), candidates as (
    select
      n.id::text as novel_id,
      n.title,
      n.genre,
      n.description,
      n.created_at,
      public.novelight_effective_publication_at(
        n.created_at, n.first_published_at
      ) as effective_publication_at,
      coalesce(n.pv, 0)::bigint as pv,
      (
        select count(*)::bigint
        from public.favorites f
        where f.novel_id::text = n.id::text
          and f.user_id <> n.user_id
      ) as favorite_count,
      coalesce((
        select array_agg(t.id order by nt.position)
        from public.novel_official_tags nt
        join public.official_tags t on t.id = nt.tag_id and t.is_active
        where nt.novel_id = n.id
      ), '{}'::text[]) as official_tag_ids,
      coalesce((
        select array_agg(t.display_name order by nt.position)
        from public.novel_official_tags nt
        join public.official_tags t on t.id = nt.tag_id and t.is_active
        where nt.novel_id = n.id
      ), '{}'::text[]) as official_tag_names,
      coalesce((
        select array_agg(ct.display_name order by ct.position)
        from public.novel_custom_tags ct
        where ct.novel_id = n.id
      ), '{}'::text[]) as custom_tag_names
    from public.novels n
    cross join requested_tag_count rtc
    where n.status = 'published'
      and coalesce(cardinality(p_official_tag_ids), 0) <= 10
      and (
        nullif(pg_catalog.btrim(coalesce(p_keyword, '')), '') is null
        or coalesce(n.title, '') ilike '%' || pg_catalog.btrim(p_keyword) || '%'
        or coalesce(n.description, '') ilike '%' || pg_catalog.btrim(p_keyword) || '%'
        or exists (
          select 1
          from public.novel_official_tags nt
          join public.official_tags t on t.id = nt.tag_id and t.is_active
          left join public.official_tag_aliases a on a.tag_id = t.id
          where nt.novel_id = n.id
            and (
              t.display_name ilike '%' || pg_catalog.btrim(p_keyword) || '%'
              or a.alias ilike '%' || pg_catalog.btrim(p_keyword) || '%'
            )
        )
        or exists (
          select 1
          from public.novel_custom_tags ct
          where ct.novel_id = n.id
            and ct.display_name ilike '%' || pg_catalog.btrim(p_keyword) || '%'
        )
      )
      and (
        nullif(pg_catalog.btrim(coalesce(p_genre, '')), '') is null
        or n.genre = pg_catalog.btrim(p_genre)
      )
      and (
        rtc.value = 0
        or (
          select count(distinct nt.tag_id)::integer
          from public.novel_official_tags nt
          join requested_tags rt on rt.tag_id = nt.tag_id
          where nt.novel_id = n.id
        ) = rtc.value
      )
  ), counted as (
    select c.*, count(*) over ()::bigint as total_count
    from candidates c
  )
  select
    c.novel_id,
    c.title,
    c.genre,
    c.description,
    c.created_at,
    c.pv,
    c.favorite_count,
    c.official_tag_ids,
    c.official_tag_names,
    c.custom_tag_names,
    c.total_count
  from counted c
  order by
    case when p_sort = 'favorites' then c.favorite_count end desc nulls last,
    case when p_sort = 'new' then c.effective_publication_at end desc nulls last,
    c.created_at desc,
    c.novel_id asc
  limit least(greatest(coalesce(p_limit, 24), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

revoke all on function public.novelight_normalize_custom_tag(text) from public, anon, authenticated;
revoke all on function public.novelight_official_tag_catalog() from public, anon, authenticated;
revoke all on function public.novelight_set_novel_tags(bigint, text[], text[]) from public, anon, authenticated;
revoke all on function public.novelight_novel_tag_labels(bigint[]) from public, anon, authenticated;
revoke all on function public.novelight_neutral_search_v2(text, text, text[], text, integer, integer)
  from public, anon, authenticated;

grant execute on function public.novelight_official_tag_catalog() to anon, authenticated;
grant execute on function public.novelight_set_novel_tags(bigint, text[], text[]) to authenticated;
grant execute on function public.novelight_novel_tag_labels(bigint[]) to anon, authenticated;
grant execute on function public.novelight_neutral_search_v2(text, text, text[], text, integer, integer)
  to anon, authenticated;

comment on table public.novel_internal_search_attributes is
  'Future-only internal search/AI attribute ledger. No beta author or reader client access; AI auto-classification is not implemented by this migration.';
comment on function public.novelight_set_novel_tags(bigint, text[], text[]) is
  'Atomic owner-bound replacement of max 10 official tags and max 5 custom tags. Official aliases cannot be duplicated as custom tags.';
comment on function public.novelight_neutral_search_v2(text, text, text[], text, integer, integer) is
  'Published-only neutral search with AND semantics for selected official tags. Rank, plan, LIGHT SEED and paid exposure are not relevance inputs.';

commit;
