-- NOVELIGHT official base_book 32 pack metadata and atomic activation.
-- Source PNG binaries are uploaded unchanged. This migration adds author-facing
-- metadata plus fail-closed staging/activation RPCs for the approved pack.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260919203910:official-base-books-32'));

alter table public.novel_thumbnail_assets
  add column if not exists display_name_ja text,
  add column if not exists material_ja text,
  add column if not exists source_pack_key text,
  add column if not exists source_file_name text,
  add column if not exists source_sha256 text;

alter table public.novel_thumbnail_assets
  drop constraint if exists novel_thumbnail_assets_display_name_ja_check,
  add constraint novel_thumbnail_assets_display_name_ja_check
    check (display_name_ja is null or char_length(trim(display_name_ja)) between 1 and 80),
  drop constraint if exists novel_thumbnail_assets_material_ja_check,
  add constraint novel_thumbnail_assets_material_ja_check
    check (material_ja is null or char_length(trim(material_ja)) between 1 and 80),
  drop constraint if exists novel_thumbnail_assets_source_pack_key_check,
  add constraint novel_thumbnail_assets_source_pack_key_check
    check (source_pack_key is null or source_pack_key ~ '^[A-Za-z0-9_.-]{1,120}$'),
  drop constraint if exists novel_thumbnail_assets_source_file_name_check,
  add constraint novel_thumbnail_assets_source_file_name_check
    check (source_file_name is null or (source_file_name !~ '[/\\]' and char_length(source_file_name) between 1 and 160 and source_file_name ~ '^[A-Za-z0-9_.-]+[.]png$')),
  drop constraint if exists novel_thumbnail_assets_source_sha256_check,
  add constraint novel_thumbnail_assets_source_sha256_check
    check (source_sha256 is null or source_sha256 ~ '^[0-9a-f]{64}$');

create unique index if not exists novel_thumbnail_assets_pack_file_unique
  on public.novel_thumbnail_assets (source_pack_key, source_file_name)
  where source_pack_key is not null and source_file_name is not null;
create unique index if not exists novel_thumbnail_assets_pack_layer_order_unique
  on public.novel_thumbnail_assets (source_pack_key, layer_type, sort_order)
  where source_pack_key is not null;

create or replace function public.novelight_admin_stage_official_base_book(
  p_admin_user_id uuid, p_display_name_ja text, p_material_ja text,
  p_storage_path text, p_image_url text, p_template_key text,
  p_display_order integer, p_source_pack_key text, p_source_file_name text,
  p_source_sha256 text
)
returns setof public.novel_thumbnail_assets
language plpgsql
security definer
set search_path = pg_catalog, public, storage
as $$
declare
  v_display_name text := trim(coalesce(p_display_name_ja, ''));
  v_material text := trim(coalesce(p_material_ja, ''));
  v_path text := trim(coalesce(p_storage_path, ''));
  v_url text := trim(coalesce(p_image_url, ''));
  v_template text := trim(coalesce(p_template_key, ''));
  v_pack text := trim(coalesce(p_source_pack_key, ''));
  v_file text := trim(coalesce(p_source_file_name, ''));
  v_sha text := lower(trim(coalesce(p_source_sha256, '')));
  v_expected_name text; v_expected_material text; v_expected_file text;
  v_expected_size bigint; v_expected_sha text;
  v_row public.novel_thumbnail_assets%rowtype;
  v_existing public.novel_thumbnail_assets%rowtype;
begin
  if p_admin_user_id is null then
    raise exception using errcode = '22023', message = 'Admin identity is required';
  end if;
  if v_pack <> 'NOVELIGHT_base_books_32_final' or v_template <> 'book-v1' then
    raise exception using errcode = '22023', message = 'Official base_book pack identity is invalid';
  end if;

  select e.display_name_ja, e.material_ja, e.file_name, e.byte_size, e.sha256
    into v_expected_name, v_expected_material, v_expected_file, v_expected_size, v_expected_sha
    from (values
    (1, 'アイボリー', 'レザー', 'base_book_ivory_holy_01.png', 1140205, 'ffa55c72fc300aae730797ef4b9d09c351f48b82ac1c4abc1a86a55419f01faa'),
    (2, 'ホワイトシルバー', 'レザー', 'base_book_white_silver_01.png', 1129236, '601bfe8ef08cedd95b559e5a67e65debedacaf2c2d14993f82ac0d1796b2956d'),
    (3, 'サンドベージュ', 'ヴィンテージレザー', 'base_book_sandstone_tan_01.png', 1490193, 'bf9afe716467372323a16f9377cd2f8da09faa071fb2f669f0f3934fdf994819'),
    (4, 'ダークブラウン', 'エイジドレザー', 'base_book_darkbrown_ancient_01.png', 1375462, 'a29f142165dd2e872144f093961ea49fa4e43bc0e2ad0dc8e87f617f3f12fd29'),
    (5, 'チャコール', 'マットレザー', 'base_book_charcoal_silver_01.png', 1309505, 'd7f64461d5a916107c93595a8eefb172041db608a86a1433ffcf88591797ad2e'),
    (6, 'ブラック', 'ダークレザー', 'base_book_black_arcane_01.png', 1232610, 'f8eb0757bcc2a770c0d9aa601be978bef238bd50ecb72d09e91ffce38328c7f0'),
    (7, 'ブラック×ゴールド', 'マットレザー', 'base_book_black_gold_01.png', 1099159, 'ad0cf5d22406c39319b96ab6cce26da9fd3db5cea517aae305135ab3136f0ff2'),
    (8, 'ガンメタル', 'ブラッシュドメタル', 'base_book_futuristic_metal_01.png', 999013, 'ff8e7e1735f3fce11be5d2aa1a2db81dcbe5ae8e476d93495fb5d30be7b9e794'),
    (9, 'レモンイエロー', 'ワックスドキャンバス', 'base_book_lemon_yellow_waxedcanvas_01.png', 1495761, 'dbd119c7eb9ec68da201a95eea082472f40554a2a3975786fdee0e5520f2f49c'),
    (10, 'アンバー', 'ラッカー', 'base_book_amber_lacquer_01.png', 979430, '75adb56828e9c2a7a30975fdff69f70e6312be739723a572a2cf693868023b8c'),
    (11, 'バーントオレンジ', 'シボ革', 'base_book_burnt_orange_pebbled_01.png', 1441135, '91ade63c5ce123c0ed5c1d3d45a05f8670783e6bab372bc1c2686225b43ad9ac'),
    (12, 'コッパー', 'ブロンズメタル', 'base_book_copper_bronze_01.png', 1283434, '8a5d5d68ffa5a714180ccf3738e8d0608698424547025edcc9ba66df6b6d559c'),
    (13, 'コーラル', '細粒レザー', 'base_book_coral_grain_01.png', 1316814, 'd535e112e527b64c7c49de40d165fd95cac839bc54e6796e78d97fe87a24df05'),
    (14, 'クリムゾン', 'レザー', 'base_book_crimson_dark_01.png', 1326043, '41628e388ad6c0b3652aba9456532c5e2ff9e658eb4eb74c3ebceb6a71169277'),
    (15, 'ワインレッド', 'クラシックレザー', 'base_book_winered_classic_01.png', 1288458, '03ff72c24640495a15f24cf80ac4b4c6d3a791b29fe89deb417387a6674e43d7'),
    (16, 'バーガンディ', 'アンティークレザー', 'base_book_burgundy_antique_01.png', 1375540, 'd11b76beb602dbbd3bd155a0c1f7cddccd0159386382a5bc24acf6377be2f2f9'),
    (17, 'ダスティローズ', 'スエード', 'base_book_dusty_rose_suede_01.png', 1247562, '10eec20e95b734f2dcdb47acb01f6873d6887c41cf888266afe9475fde03ba6c'),
    (18, 'マゼンタ', 'サテン', 'base_book_magenta_satin_01.png', 1151616, 'c0db28f4b326af091dba0fe30c06faac8e269d82987a6d6421d0f3b699c9d959'),
    (19, 'ラベンダー', 'ベルベット', 'base_book_lavender_velvet_01.png', 1326807, 'aa19c081f6ca70a659dbb9970ad43c237dd6cd8fb306f00abaf0127c79595ea4'),
    (20, 'パープル', 'ダークレザー', 'base_book_purple_occult_01.png', 1321982, 'c23d3d52325524baf26b638abcf6b7075091b8f8d1637e8f2952bc3f49133d19'),
    (21, 'ロイヤルブルー', 'レザー', 'base_book_royal_blue_01.png', 1278065, '32a76d39a4de868743550248107122d3039d7761cd70af57540a61d3b6007c63'),
    (22, 'ネイビー', 'レザー', 'base_book_navy_leather_01.png', 1639460, '0ad60c41b1bc587cffce7453adde1db97ca6a88b10e8cd751d7e8f6d67856a8c'),
    (23, 'シルバーブルー', 'レザー', 'base_book_silverblue_01.png', 1394522, 'fbb4a01a1310b26aee9cb5b06893a626a81f39af778ea29c13c45d9eccdf7a15'),
    (24, 'スカイブルー', 'リネン', 'base_book_skyblue_linen_01.png', 1479683, 'b85f22dc6e0193998e377ff43ea27cfa12754afc750465425e83251a4a94cf80'),
    (25, 'ターコイズ', 'グレーズドレザー', 'base_book_turquoise_glazed_01.png', 1292003, 'c816eb75a8c1917ea3fd16a92cdabe56263a9d661ff92518ff678e253a63f315'),
    (26, 'ティール', 'レザー', 'base_book_teal_mystic_01.png', 1306447, '46f963f521feafc2cf69a5fc1f4d3d6467577ea8a641a2c64fde2b1e5b4fb825'),
    (27, 'ミント', 'クロス', 'base_book_mint_cloth_01.png', 1587871, '746cc2ad3c424b71e58a150cc1b974fad0f059771c4ca8f7c98dbaf87d598d9f'),
    (28, 'フォレスト', 'マットレザー', 'base_book_forest_leather_01.png', 1433297, '67e427520e3eff89190858b17e99b7dd447e537e3730862b47e07b1d0b55c773'),
    (29, 'ディープグリーン', 'アンティークレザー', 'base_book_deepgreen_antique_01.png', 1336363, 'bc9f3abe497a826b070fdc8964b8fbffe7d99df23f6aea0fc3c594dead0b33c0'),
    (30, 'ゴールド', 'ブラッシュドメタル', 'base_book_gold_brushed_01.png', 1096660, '7238ff732ee503071d5a5dc53150d1c6391067794afc01a878ae598376941de3'),
    (31, 'ナチュラル', '和紙', 'base_book_japanese_washi_01.png', 1310399, 'b1d6912f280cf302f0dc206c8481afcac39440b6f8a7cedd8c3ef0aabbac5a0d'),
    (32, 'オーロラ', 'パール', 'base_book_iridescent_pearl_01.png', 993227, 'dca07dd738d850fa08a1a0230d02c731df6e58933976c2ecbd4ae6ca14772293')
    ) as e(display_order, display_name_ja, material_ja, file_name, byte_size, sha256)
   where e.display_order = p_display_order;
  if not found
     or v_display_name <> v_expected_name or v_material <> v_expected_material
     or v_file <> v_expected_file or v_sha <> v_expected_sha then
    raise exception using errcode = '23514', message = 'Official base_book manifest metadata mismatch';
  end if;
  if v_path !~ '^official/[0-9a-f-]{36}[.]png$' or v_url not like 'https://%' then
    raise exception using errcode = '22023', message = 'Official base_book Storage metadata is invalid';
  end if;
  if not exists (
    select 1 from public.novel_thumbnail_templates t
     where t.template_key = 'book-v1' and t.availability_status <> 'emergency_disabled'
       and t.canvas_width = 1086 and t.canvas_height = 1448
  ) then
    raise exception using errcode = '23514', message = 'book-v1 template is unavailable';
  end if;
  if not exists (
    select 1 from storage.objects o
     where o.bucket_id = 'novel-thumbnails' and o.name = v_path
       and coalesce(o.metadata->>'mimetype', '') = 'image/png'
       and coalesce((o.metadata->>'size')::bigint, -1) = v_expected_size
  ) then
    raise exception using errcode = '23514', message = 'Official base_book Storage object mismatch';
  end if;

  select * into v_existing
    from public.novel_thumbnail_assets
   where source_pack_key = v_pack and source_file_name = v_file
   for update;
  if found then
    if v_existing.display_name_ja = v_expected_name
       and v_existing.material_ja = v_expected_material
       and v_existing.source_sha256 = v_expected_sha
       and v_existing.sort_order = p_display_order
       and v_existing.layer_type = 'base_book'
       and v_existing.template_key = 'book-v1'
       and v_existing.storage_path = v_path
       and v_existing.image_url = v_url
       and v_existing.availability_status in ('retired','active') then
      return next v_existing; return;
    end if;
    raise exception using errcode = '23505', message = 'Official base_book source file already exists with different metadata';
  end if;

  insert into public.novel_thumbnail_assets (
    label, storage_path, image_url, is_active, created_by, layer_type, template_key,
    sort_order, availability_status, display_name_ja, material_ja,
    source_pack_key, source_file_name, source_sha256
  ) values (
    v_display_name, v_path, v_url, false, p_admin_user_id, 'base_book', 'book-v1',
    p_display_order, 'retired', v_display_name, v_material,
    v_pack, v_file, v_sha
  ) returning * into v_row;

  insert into public.admin_operation_audit (
    admin_user_id, action, resource_type, resource_id, metadata
  ) values (
    p_admin_user_id, 'thumbnail.base_book_pack.stage', 'novel_thumbnail_asset', v_row.id::text,
    jsonb_build_object('pack_key',v_pack,'source_file_name',v_file,'source_sha256',v_sha,
      'display_order',p_display_order,'display_name_ja',v_display_name,'material_ja',v_material)
  );
  return next v_row;
end;
$$;

revoke all on function public.novelight_admin_stage_official_base_book(
  uuid,text,text,text,text,text,integer,text,text,text
) from public, anon, authenticated;
grant execute on function public.novelight_admin_stage_official_base_book(
  uuid,text,text,text,text,text,integer,text,text,text
) to service_role;

create or replace function public.novelight_admin_activate_official_base_book_pack(
  p_admin_user_id uuid, p_source_pack_key text,
  p_top_left_x integer, p_top_left_y integer, p_top_right_x integer, p_top_right_y integer,
  p_bottom_right_x integer, p_bottom_right_y integer, p_bottom_left_x integer, p_bottom_left_y integer,
  p_mask_revision uuid, p_mask_storage_path text, p_mask_url text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, storage
as $$
declare
  v_pack text := trim(coalesce(p_source_pack_key, ''));
  v_expected_mask_path text;
  v_count integer; v_bad integer; v_retired integer;
  v_template public.novel_thumbnail_templates%rowtype;
begin
  if p_admin_user_id is null then
    raise exception using errcode = '22023', message = 'Admin identity is required';
  end if;
  if v_pack <> 'NOVELIGHT_base_books_32_final' or p_mask_revision is null then
    raise exception using errcode = '22023', message = 'Official base_book activation metadata is invalid';
  end if;
  v_expected_mask_path := 'generated-masks/book-v1/' || p_mask_revision::text || '/book-v1-cover-mask.png';
  if coalesce(p_mask_storage_path,'') <> v_expected_mask_path or coalesce(p_mask_url,'') not like 'https://%' then
    raise exception using errcode = '22023', message = 'Derived cover mask location is invalid';
  end if;
  if not exists (
    select 1 from storage.objects o
     where o.bucket_id='novel-thumbnails' and o.name=p_mask_storage_path
       and coalesce(o.metadata->>'mimetype','')='image/png'
  ) then
    raise exception using errcode = '23514', message = 'Derived cover mask Storage object is missing';
  end if;

  select * into v_template
    from public.novel_thumbnail_templates where template_key='book-v1' for update;
  if not found or v_template.canvas_width<>1086 or v_template.canvas_height<>1448
     or v_template.availability_status='emergency_disabled' then
    raise exception using errcode = '23514', message = 'book-v1 template geometry is unavailable';
  end if;
  if not coalesce(public.novelight_geometry_quad_valid(
    1086,1448,p_top_left_x,p_top_left_y,p_top_right_x,p_top_right_y,
    p_bottom_right_x,p_bottom_right_y,p_bottom_left_x,p_bottom_left_y
  ),false) then
    raise exception using errcode = '23514', message = 'Official base_book cover quad is invalid';
  end if;
  if exists (
    select 1 from public.novel_thumbnail_compositions c
    join public.novel_thumbnail_assets a on a.id=c.base_book_asset_id
    where c.template_key='book-v1' and a.source_pack_key is distinct from v_pack
  ) then
    raise exception using errcode = '23514', message = 'A saved composition still references a legacy base_book';
  end if;

  perform 1 from public.novel_thumbnail_assets where source_pack_key=v_pack for update;
  select count(*)::integer into v_count
    from public.novel_thumbnail_assets where source_pack_key=v_pack;

  with expected(display_order,display_name_ja,material_ja,file_name,byte_size,sha256) as (
    values
    (1, 'アイボリー', 'レザー', 'base_book_ivory_holy_01.png', 1140205, 'ffa55c72fc300aae730797ef4b9d09c351f48b82ac1c4abc1a86a55419f01faa'),
    (2, 'ホワイトシルバー', 'レザー', 'base_book_white_silver_01.png', 1129236, '601bfe8ef08cedd95b559e5a67e65debedacaf2c2d14993f82ac0d1796b2956d'),
    (3, 'サンドベージュ', 'ヴィンテージレザー', 'base_book_sandstone_tan_01.png', 1490193, 'bf9afe716467372323a16f9377cd2f8da09faa071fb2f669f0f3934fdf994819'),
    (4, 'ダークブラウン', 'エイジドレザー', 'base_book_darkbrown_ancient_01.png', 1375462, 'a29f142165dd2e872144f093961ea49fa4e43bc0e2ad0dc8e87f617f3f12fd29'),
    (5, 'チャコール', 'マットレザー', 'base_book_charcoal_silver_01.png', 1309505, 'd7f64461d5a916107c93595a8eefb172041db608a86a1433ffcf88591797ad2e'),
    (6, 'ブラック', 'ダークレザー', 'base_book_black_arcane_01.png', 1232610, 'f8eb0757bcc2a770c0d9aa601be978bef238bd50ecb72d09e91ffce38328c7f0'),
    (7, 'ブラック×ゴールド', 'マットレザー', 'base_book_black_gold_01.png', 1099159, 'ad0cf5d22406c39319b96ab6cce26da9fd3db5cea517aae305135ab3136f0ff2'),
    (8, 'ガンメタル', 'ブラッシュドメタル', 'base_book_futuristic_metal_01.png', 999013, 'ff8e7e1735f3fce11be5d2aa1a2db81dcbe5ae8e476d93495fb5d30be7b9e794'),
    (9, 'レモンイエロー', 'ワックスドキャンバス', 'base_book_lemon_yellow_waxedcanvas_01.png', 1495761, 'dbd119c7eb9ec68da201a95eea082472f40554a2a3975786fdee0e5520f2f49c'),
    (10, 'アンバー', 'ラッカー', 'base_book_amber_lacquer_01.png', 979430, '75adb56828e9c2a7a30975fdff69f70e6312be739723a572a2cf693868023b8c'),
    (11, 'バーントオレンジ', 'シボ革', 'base_book_burnt_orange_pebbled_01.png', 1441135, '91ade63c5ce123c0ed5c1d3d45a05f8670783e6bab372bc1c2686225b43ad9ac'),
    (12, 'コッパー', 'ブロンズメタル', 'base_book_copper_bronze_01.png', 1283434, '8a5d5d68ffa5a714180ccf3738e8d0608698424547025edcc9ba66df6b6d559c'),
    (13, 'コーラル', '細粒レザー', 'base_book_coral_grain_01.png', 1316814, 'd535e112e527b64c7c49de40d165fd95cac839bc54e6796e78d97fe87a24df05'),
    (14, 'クリムゾン', 'レザー', 'base_book_crimson_dark_01.png', 1326043, '41628e388ad6c0b3652aba9456532c5e2ff9e658eb4eb74c3ebceb6a71169277'),
    (15, 'ワインレッド', 'クラシックレザー', 'base_book_winered_classic_01.png', 1288458, '03ff72c24640495a15f24cf80ac4b4c6d3a791b29fe89deb417387a6674e43d7'),
    (16, 'バーガンディ', 'アンティークレザー', 'base_book_burgundy_antique_01.png', 1375540, 'd11b76beb602dbbd3bd155a0c1f7cddccd0159386382a5bc24acf6377be2f2f9'),
    (17, 'ダスティローズ', 'スエード', 'base_book_dusty_rose_suede_01.png', 1247562, '10eec20e95b734f2dcdb47acb01f6873d6887c41cf888266afe9475fde03ba6c'),
    (18, 'マゼンタ', 'サテン', 'base_book_magenta_satin_01.png', 1151616, 'c0db28f4b326af091dba0fe30c06faac8e269d82987a6d6421d0f3b699c9d959'),
    (19, 'ラベンダー', 'ベルベット', 'base_book_lavender_velvet_01.png', 1326807, 'aa19c081f6ca70a659dbb9970ad43c237dd6cd8fb306f00abaf0127c79595ea4'),
    (20, 'パープル', 'ダークレザー', 'base_book_purple_occult_01.png', 1321982, 'c23d3d52325524baf26b638abcf6b7075091b8f8d1637e8f2952bc3f49133d19'),
    (21, 'ロイヤルブルー', 'レザー', 'base_book_royal_blue_01.png', 1278065, '32a76d39a4de868743550248107122d3039d7761cd70af57540a61d3b6007c63'),
    (22, 'ネイビー', 'レザー', 'base_book_navy_leather_01.png', 1639460, '0ad60c41b1bc587cffce7453adde1db97ca6a88b10e8cd751d7e8f6d67856a8c'),
    (23, 'シルバーブルー', 'レザー', 'base_book_silverblue_01.png', 1394522, 'fbb4a01a1310b26aee9cb5b06893a626a81f39af778ea29c13c45d9eccdf7a15'),
    (24, 'スカイブルー', 'リネン', 'base_book_skyblue_linen_01.png', 1479683, 'b85f22dc6e0193998e377ff43ea27cfa12754afc750465425e83251a4a94cf80'),
    (25, 'ターコイズ', 'グレーズドレザー', 'base_book_turquoise_glazed_01.png', 1292003, 'c816eb75a8c1917ea3fd16a92cdabe56263a9d661ff92518ff678e253a63f315'),
    (26, 'ティール', 'レザー', 'base_book_teal_mystic_01.png', 1306447, '46f963f521feafc2cf69a5fc1f4d3d6467577ea8a641a2c64fde2b1e5b4fb825'),
    (27, 'ミント', 'クロス', 'base_book_mint_cloth_01.png', 1587871, '746cc2ad3c424b71e58a150cc1b974fad0f059771c4ca8f7c98dbaf87d598d9f'),
    (28, 'フォレスト', 'マットレザー', 'base_book_forest_leather_01.png', 1433297, '67e427520e3eff89190858b17e99b7dd447e537e3730862b47e07b1d0b55c773'),
    (29, 'ディープグリーン', 'アンティークレザー', 'base_book_deepgreen_antique_01.png', 1336363, 'bc9f3abe497a826b070fdc8964b8fbffe7d99df23f6aea0fc3c594dead0b33c0'),
    (30, 'ゴールド', 'ブラッシュドメタル', 'base_book_gold_brushed_01.png', 1096660, '7238ff732ee503071d5a5dc53150d1c6391067794afc01a878ae598376941de3'),
    (31, 'ナチュラル', '和紙', 'base_book_japanese_washi_01.png', 1310399, 'b1d6912f280cf302f0dc206c8481afcac39440b6f8a7cedd8c3ef0aabbac5a0d'),
    (32, 'オーロラ', 'パール', 'base_book_iridescent_pearl_01.png', 993227, 'dca07dd738d850fa08a1a0230d02c731df6e58933976c2ecbd4ae6ca14772293')
  ), checked as (
    select e.*, a.id, a.label, a.display_name_ja as actual_display_name,
      a.material_ja as actual_material, a.source_file_name, a.source_sha256,
      a.layer_type, a.template_key, a.sort_order, a.availability_status, a.is_active,
      o.id as storage_id, o.metadata as storage_metadata
    from expected e
    left join public.novel_thumbnail_assets a
      on a.source_pack_key=v_pack and a.sort_order=e.display_order
    left join storage.objects o
      on o.bucket_id='novel-thumbnails' and o.name=a.storage_path
  )
  select count(*)::integer into v_bad
    from checked c
   where c.id is null
      or c.label<>c.display_name_ja
      or c.actual_display_name<>c.display_name_ja
      or c.actual_material<>c.material_ja
      or c.source_file_name<>c.file_name
      or c.source_sha256<>c.sha256
      or c.layer_type<>'base_book' or c.template_key<>'book-v1'
      or c.sort_order<>c.display_order
      or c.availability_status<>'retired' or c.is_active is distinct from false
      or c.storage_id is null
      or coalesce(c.storage_metadata->>'mimetype','')<>'image/png'
      or coalesce((c.storage_metadata->>'size')::bigint,-1)<>c.byte_size;
  if v_count<>32 or v_bad<>0 then
    raise exception using errcode = '23514', message = 'Official base_book pack integrity check failed';
  end if;

  update public.novel_thumbnail_assets
     set availability_status='retired', is_active=false
   where layer_type='base_book' and template_key='book-v1'
     and source_pack_key is distinct from v_pack and availability_status='active';
  get diagnostics v_retired = row_count;
  update public.novel_thumbnail_assets
     set availability_status='active', is_active=true
   where source_pack_key=v_pack and layer_type='base_book' and template_key='book-v1';

  update public.novel_thumbnail_templates
     set cover_top_left_x=p_top_left_x, cover_top_left_y=p_top_left_y,
         cover_top_right_x=p_top_right_x, cover_top_right_y=p_top_right_y,
         cover_bottom_right_x=p_bottom_right_x, cover_bottom_right_y=p_bottom_right_y,
         cover_bottom_left_x=p_bottom_left_x, cover_bottom_left_y=p_bottom_left_y,
         cover_mask_source='cover_quad', cover_mask_revision=p_mask_revision,
         cover_mask_storage_path=p_mask_storage_path, cover_mask_url=p_mask_url, updated_at=now()
   where template_key='book-v1';

  update public.novel_thumbnail_compositions c
     set revision=gen_random_uuid(), render_storage_path=null, render_url=null, updated_at=now()
   where c.template_key='book-v1';
  update public.novels n set thumbnail_url=null
    from public.novel_thumbnail_compositions c
   where n.id=c.novel_id and c.template_key='book-v1' and n.thumbnail_asset_id is null;

  insert into public.admin_operation_audit (
    admin_user_id,action,resource_type,resource_id,metadata
  ) values (
    p_admin_user_id,'thumbnail.base_book_pack.activate','novel_thumbnail_asset_pack',v_pack,
    jsonb_build_object('asset_count',32,'retired_previous_base_books',v_retired,
      'cover_quad',jsonb_build_object(
        'top_left',jsonb_build_object('x',p_top_left_x,'y',p_top_left_y),
        'top_right',jsonb_build_object('x',p_top_right_x,'y',p_top_right_y),
        'bottom_right',jsonb_build_object('x',p_bottom_right_x,'y',p_bottom_right_y),
        'bottom_left',jsonb_build_object('x',p_bottom_left_x,'y',p_bottom_left_y)),
      'mask_revision',p_mask_revision,'mask_storage_path',p_mask_storage_path)
  );
  return jsonb_build_object('pack_key',v_pack,'active_asset_count',32,
    'retired_previous_base_books',v_retired,'cover_mask_revision',p_mask_revision,
    'cover_mask_storage_path',p_mask_storage_path);
end;
$$;

revoke all on function public.novelight_admin_activate_official_base_book_pack(
  uuid,text,integer,integer,integer,integer,integer,integer,integer,integer,uuid,text,text
) from public, anon, authenticated;
grant execute on function public.novelight_admin_activate_official_base_book_pack(
  uuid,text,integer,integer,integer,integer,integer,integer,integer,integer,uuid,text,text
) to service_role;

commit;
