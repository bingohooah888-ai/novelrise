-- NOVELIGHT Chapter 39: official layered thumbnail composition.
-- Keeps legacy complete thumbnails readable while introducing a 1086x1448
-- template/layer model, author-owned compositions, and cached render metadata.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260910220000'));

-- Existing complete thumbnails remain as a legacy compatibility class.
alter table public.novel_thumbnail_assets
  add column if not exists layer_type text,
  add column if not exists template_key text,
  add column if not exists sort_order integer,
  add column if not exists availability_status text;

update public.novel_thumbnail_assets
   set layer_type = coalesce(layer_type, 'legacy_complete'),
       template_key = coalesce(template_key, 'legacy-complete-v1'),
       sort_order = coalesce(sort_order, 1000),
       availability_status = coalesce(
         availability_status,
         case when is_active then 'active' else 'retired' end
       );

alter table public.novel_thumbnail_assets
  alter column layer_type set not null,
  alter column template_key set not null,
  alter column sort_order set not null,
  alter column availability_status set not null;

alter table public.novel_thumbnail_assets
  alter column sort_order set default 1000,
  alter column availability_status set default 'active';

alter table public.novel_thumbnail_assets
  drop constraint if exists novel_thumbnail_assets_layer_type_check,
  add constraint novel_thumbnail_assets_layer_type_check check (
    layer_type in (
      'background',
      'base_book',
      'cover',
      'pattern',
      'symbol',
      'frame',
      'effect',
      'cover_mask',
      'legacy_complete'
    )
  ),
  drop constraint if exists novel_thumbnail_assets_template_key_check,
  add constraint novel_thumbnail_assets_template_key_check check (
    template_key ~ '^[a-z0-9][a-z0-9-]{0,63}$'
  ),
  drop constraint if exists novel_thumbnail_assets_sort_order_check,
  add constraint novel_thumbnail_assets_sort_order_check check (
    sort_order between 0 and 100000
  ),
  drop constraint if exists novel_thumbnail_assets_availability_status_check,
  add constraint novel_thumbnail_assets_availability_status_check check (
    availability_status in ('active', 'retired', 'emergency_disabled')
  );

create index if not exists novel_thumbnail_assets_composer_idx
  on public.novel_thumbnail_assets (
    template_key,
    layer_type,
    availability_status,
    sort_order,
    created_at
  );

create table if not exists public.novel_thumbnail_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null unique,
  label text not null,
  canvas_width integer not null default 1086,
  canvas_height integer not null default 1448,
  cover_mask_storage_path text,
  cover_mask_url text,
  availability_status text not null default 'active',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint novel_thumbnail_templates_key_check check (
    template_key ~ '^[a-z0-9][a-z0-9-]{0,63}$'
  ),
  constraint novel_thumbnail_templates_label_check check (
    char_length(trim(label)) between 1 and 80
  ),
  constraint novel_thumbnail_templates_canvas_check check (
    canvas_width = 1086 and canvas_height = 1448
  ),
  constraint novel_thumbnail_templates_status_check check (
    availability_status in ('active', 'retired', 'emergency_disabled')
  ),
  constraint novel_thumbnail_templates_mask_pair_check check (
    (cover_mask_storage_path is null and cover_mask_url is null)
    or
    (cover_mask_storage_path is not null and cover_mask_url like 'https://%')
  )
);

insert into public.novel_thumbnail_templates (
  template_key,
  label,
  canvas_width,
  canvas_height,
  availability_status
) values (
  'book-v1',
  '基準本テンプレート v1',
  1086,
  1448,
  'active'
)
on conflict (template_key) do nothing;

alter table public.novel_thumbnail_templates enable row level security;
revoke all on table public.novel_thumbnail_templates from anon, authenticated;
grant select on table public.novel_thumbnail_templates to anon, authenticated;
grant all on table public.novel_thumbnail_templates to service_role;

drop policy if exists "Public can read active thumbnail templates"
  on public.novel_thumbnail_templates;
create policy "Public can read active thumbnail templates"
  on public.novel_thumbnail_templates
  for select
  to anon, authenticated
  using (availability_status = 'active');

-- Only currently selectable assets are exposed directly through the Data API.
-- Retired assets remain available to existing compositions through the guarded RPC.
drop policy if exists "Public can read active official thumbnails"
  on public.novel_thumbnail_assets;
create policy "Public can read active official thumbnails"
  on public.novel_thumbnail_assets
  for select
  to anon, authenticated
  using (availability_status = 'active');

create or replace function public.novelight_sync_thumbnail_asset_status()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.availability_status is distinct from old.availability_status then
    new.is_active := new.availability_status = 'active';
  elsif new.is_active is distinct from old.is_active then
    new.availability_status := case when new.is_active then 'active' else 'retired' end;
  else
    new.is_active := new.availability_status = 'active';
  end if;
  return new;
end;
$$;

revoke all on function public.novelight_sync_thumbnail_asset_status() from public;

drop trigger if exists novelight_sync_thumbnail_asset_status
  on public.novel_thumbnail_assets;
create trigger novelight_sync_thumbnail_asset_status
before update of availability_status, is_active
on public.novel_thumbnail_assets
for each row execute function public.novelight_sync_thumbnail_asset_status();

create table if not exists public.novel_thumbnail_compositions (
  novel_id bigint primary key references public.novels(id) on delete cascade,
  template_key text not null references public.novel_thumbnail_templates(template_key),
  background_asset_id uuid not null references public.novel_thumbnail_assets(id),
  base_book_asset_id uuid not null references public.novel_thumbnail_assets(id),
  cover_asset_id uuid not null references public.novel_thumbnail_assets(id),
  pattern_asset_id uuid references public.novel_thumbnail_assets(id),
  symbol_asset_id uuid references public.novel_thumbnail_assets(id),
  frame_asset_id uuid references public.novel_thumbnail_assets(id),
  effect_asset_id uuid references public.novel_thumbnail_assets(id),
  revision uuid not null default gen_random_uuid(),
  render_storage_path text,
  render_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint novel_thumbnail_compositions_render_pair_check check (
    (render_storage_path is null and render_url is null)
    or
    (
      render_storage_path ~ '^renders/[0-9]+/[0-9a-f-]{36}\\.webp$'
      and render_url like 'https://%'
    )
  )
);

create index if not exists novel_thumbnail_compositions_revision_idx
  on public.novel_thumbnail_compositions (revision);

alter table public.novel_thumbnail_compositions enable row level security;
revoke all on table public.novel_thumbnail_compositions from anon, authenticated;
grant all on table public.novel_thumbnail_compositions to service_role;

-- Chapter 39 compositions replace the previous requirement that every novel
-- directly reference one legacy completed thumbnail asset. Existing references
-- are retained and continue to render until an author saves a composition.
alter table public.novels
  alter column thumbnail_asset_id drop not null;

create or replace function public.novelight_sync_official_thumbnail()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_url text;
begin
  if new.thumbnail_asset_id is not null then
    select asset.image_url
      into v_url
      from public.novel_thumbnail_assets asset
     where asset.id = new.thumbnail_asset_id
       and asset.availability_status <> 'emergency_disabled';

    if v_url is null then
      raise exception 'Selected official thumbnail is unavailable'
        using errcode = '23514';
    end if;

    new.thumbnail_url := v_url;
    return new;
  end if;

  select composition.render_url
    into v_url
    from public.novel_thumbnail_compositions composition
   where composition.novel_id = new.id;

  -- Never accept an arbitrary client supplied URL. A composed render URL must
  -- originate from the service-only render finalization path.
  new.thumbnail_url := v_url;
  return new;
end;
$$;

revoke all on function public.novelight_sync_official_thumbnail() from public;

create or replace function public.novelight_set_my_thumbnail_composition(
  p_novel_id bigint,
  p_template_key text,
  p_background_asset_id uuid,
  p_base_book_asset_id uuid,
  p_cover_asset_id uuid,
  p_pattern_asset_id uuid default null,
  p_symbol_asset_id uuid default null,
  p_frame_asset_id uuid default null,
  p_effect_asset_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := (select auth.uid());
  v_revision uuid := gen_random_uuid();
  v_template text := trim(coalesce(p_template_key, ''));
  v_layer record;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if p_novel_id is null or not exists (
    select 1
      from public.novels n
     where n.id = p_novel_id
       and n.user_id = v_uid
  ) then
    raise exception using errcode = '42501', message = 'Novel not found or not owned by current user';
  end if;

  if not exists (
    select 1
      from public.novel_thumbnail_templates t
     where t.template_key = v_template
       and t.availability_status = 'active'
       and t.canvas_width = 1086
       and t.canvas_height = 1448
  ) then
    raise exception using errcode = '22023', message = 'Thumbnail template is unavailable';
  end if;

  for v_layer in
    select * from (values
      ('background'::text, p_background_asset_id, true),
      ('base_book'::text, p_base_book_asset_id, true),
      ('cover'::text, p_cover_asset_id, true),
      ('pattern'::text, p_pattern_asset_id, false),
      ('symbol'::text, p_symbol_asset_id, false),
      ('frame'::text, p_frame_asset_id, false),
      ('effect'::text, p_effect_asset_id, false)
    ) as requested(layer_type, asset_id, required)
  loop
    if v_layer.required and v_layer.asset_id is null then
      raise exception using errcode = '22023', message = 'Required thumbnail layer is missing';
    end if;

    if v_layer.asset_id is not null and not exists (
      select 1
        from public.novel_thumbnail_assets a
       where a.id = v_layer.asset_id
         and a.layer_type = v_layer.layer_type
         and a.template_key = v_template
         and a.availability_status = 'active'
    ) then
      raise exception using errcode = '22023', message = 'Thumbnail layer is unavailable or incompatible';
    end if;
  end loop;

  insert into public.novel_thumbnail_compositions (
    novel_id,
    template_key,
    background_asset_id,
    base_book_asset_id,
    cover_asset_id,
    pattern_asset_id,
    symbol_asset_id,
    frame_asset_id,
    effect_asset_id,
    revision,
    render_storage_path,
    render_url,
    updated_at
  ) values (
    p_novel_id,
    v_template,
    p_background_asset_id,
    p_base_book_asset_id,
    p_cover_asset_id,
    p_pattern_asset_id,
    p_symbol_asset_id,
    p_frame_asset_id,
    p_effect_asset_id,
    v_revision,
    null,
    null,
    now()
  )
  on conflict (novel_id) do update
    set template_key = excluded.template_key,
        background_asset_id = excluded.background_asset_id,
        base_book_asset_id = excluded.base_book_asset_id,
        cover_asset_id = excluded.cover_asset_id,
        pattern_asset_id = excluded.pattern_asset_id,
        symbol_asset_id = excluded.symbol_asset_id,
        frame_asset_id = excluded.frame_asset_id,
        effect_asset_id = excluded.effect_asset_id,
        revision = excluded.revision,
        render_storage_path = null,
        render_url = null,
        updated_at = now();

  update public.novels
     set thumbnail_asset_id = null,
         thumbnail_url = null
   where id = p_novel_id
     and user_id = v_uid;

  return jsonb_build_object(
    'novel_id', p_novel_id,
    'template_key', v_template,
    'revision', v_revision
  );
end;
$$;

revoke all on function public.novelight_set_my_thumbnail_composition(
  bigint, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid
) from public, anon;
grant execute on function public.novelight_set_my_thumbnail_composition(
  bigint, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid
) to authenticated;

create or replace function public.novelight_thumbnail_compositions(
  p_novel_ids bigint[]
)
returns table (
  novel_id bigint,
  template_key text,
  canvas_width integer,
  canvas_height integer,
  cover_mask_url text,
  background_url text,
  base_book_url text,
  cover_url text,
  pattern_url text,
  symbol_url text,
  frame_url text,
  effect_url text,
  revision uuid,
  render_url text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if p_novel_ids is null or cardinality(p_novel_ids) = 0 then
    return;
  end if;

  if cardinality(p_novel_ids) > 100 then
    raise exception using errcode = '22023', message = 'Too many novel ids';
  end if;

  return query
  select
    c.novel_id,
    c.template_key,
    t.canvas_width,
    t.canvas_height,
    case when t.availability_status <> 'emergency_disabled' then t.cover_mask_url end,
    case when bg.availability_status <> 'emergency_disabled' then bg.image_url end,
    case when book.availability_status <> 'emergency_disabled' then book.image_url end,
    case when cover.availability_status <> 'emergency_disabled' then cover.image_url end,
    case when pattern.availability_status <> 'emergency_disabled' then pattern.image_url end,
    case when symbol.availability_status <> 'emergency_disabled' then symbol.image_url end,
    case when frame.availability_status <> 'emergency_disabled' then frame.image_url end,
    case when effect.availability_status <> 'emergency_disabled' then effect.image_url end,
    c.revision,
    c.render_url
  from public.novel_thumbnail_compositions c
  join public.novels n on n.id = c.novel_id
  join public.novel_thumbnail_templates t on t.template_key = c.template_key
  join public.novel_thumbnail_assets bg on bg.id = c.background_asset_id
  join public.novel_thumbnail_assets book on book.id = c.base_book_asset_id
  join public.novel_thumbnail_assets cover on cover.id = c.cover_asset_id
  left join public.novel_thumbnail_assets pattern on pattern.id = c.pattern_asset_id
  left join public.novel_thumbnail_assets symbol on symbol.id = c.symbol_asset_id
  left join public.novel_thumbnail_assets frame on frame.id = c.frame_asset_id
  left join public.novel_thumbnail_assets effect on effect.id = c.effect_asset_id
  where c.novel_id = any(p_novel_ids)
    and (
      n.status = 'published'
      or (select auth.uid()) = n.user_id
    );
end;
$$;

revoke all on function public.novelight_thumbnail_compositions(bigint[]) from public;
grant execute on function public.novelight_thumbnail_compositions(bigint[]) to anon, authenticated;

create or replace function public.novelight_attach_thumbnail_render(
  p_novel_id bigint,
  p_revision uuid,
  p_storage_path text,
  p_render_url text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_novel_id is null
     or p_revision is null
     or p_storage_path !~ '^renders/[0-9]+/[0-9a-f-]{36}\\.webp$'
     or p_render_url not like 'https://%'
  then
    raise exception using errcode = '22023', message = 'Invalid thumbnail render metadata';
  end if;

  update public.novel_thumbnail_compositions
     set render_storage_path = p_storage_path,
         render_url = p_render_url,
         updated_at = now()
   where novel_id = p_novel_id
     and revision = p_revision;

  if not found then
    return false;
  end if;

  update public.novels
     set thumbnail_asset_id = null,
         thumbnail_url = p_render_url
   where id = p_novel_id;

  return found;
end;
$$;

revoke all on function public.novelight_attach_thumbnail_render(
  bigint, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.novelight_attach_thumbnail_render(
  bigint, uuid, text, text
) to service_role;

create or replace function public.novelight_admin_register_thumbnail_layer_asset(
  p_admin_user_id uuid,
  p_label text,
  p_storage_path text,
  p_image_url text,
  p_layer_type text,
  p_template_key text,
  p_sort_order integer default 1000,
  p_status text default 'active'
)
returns setof public.novel_thumbnail_assets
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_label text := trim(coalesce(p_label, ''));
  v_path text := trim(coalesce(p_storage_path, ''));
  v_url text := trim(coalesce(p_image_url, ''));
  v_layer text := trim(coalesce(p_layer_type, ''));
  v_template text := trim(coalesce(p_template_key, ''));
  v_status text := trim(coalesce(p_status, ''));
  v_row public.novel_thumbnail_assets%rowtype;
begin
  if p_admin_user_id is null then
    raise exception using errcode = '22023', message = 'Admin identity is required';
  end if;
  if char_length(v_label) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'Thumbnail label is invalid';
  end if;
  if v_path !~ '^official/[0-9a-f-]{36}\\.(webp|png|jpg|jpeg)$' then
    raise exception using errcode = '22023', message = 'Thumbnail storage path is invalid';
  end if;
  if v_url not like 'https://%' then
    raise exception using errcode = '22023', message = 'Thumbnail URL is invalid';
  end if;
  if v_layer not in ('background','base_book','cover','pattern','symbol','frame','effect','cover_mask') then
    raise exception using errcode = '22023', message = 'Thumbnail layer type is invalid';
  end if;
  if v_status not in ('active','retired','emergency_disabled') then
    raise exception using errcode = '22023', message = 'Thumbnail status is invalid';
  end if;
  if p_sort_order is null or p_sort_order not between 0 and 100000 then
    raise exception using errcode = '22023', message = 'Thumbnail sort order is invalid';
  end if;
  if not exists (
    select 1 from public.novel_thumbnail_templates t
     where t.template_key = v_template
       and t.availability_status <> 'emergency_disabled'
  ) then
    raise exception using errcode = '22023', message = 'Thumbnail template is unavailable';
  end if;

  insert into public.novel_thumbnail_assets (
    label,
    storage_path,
    image_url,
    is_active,
    created_by,
    layer_type,
    template_key,
    sort_order,
    availability_status
  ) values (
    v_label,
    v_path,
    v_url,
    v_status = 'active',
    p_admin_user_id,
    v_layer,
    v_template,
    p_sort_order,
    v_status
  )
  returning * into v_row;

  if v_layer = 'cover_mask' and v_status = 'active' then
    update public.novel_thumbnail_templates
       set cover_mask_storage_path = v_path,
           cover_mask_url = v_url,
           updated_at = now()
     where template_key = v_template;
  end if;

  insert into public.admin_operation_audit (
    admin_user_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) values (
    p_admin_user_id,
    'thumbnail.layer.create',
    'novel_thumbnail_asset',
    v_row.id::text,
    jsonb_build_object(
      'storage_path', v_row.storage_path,
      'template_key', v_row.template_key,
      'layer_type', v_row.layer_type,
      'status', v_row.availability_status
    )
  );

  return next v_row;
end;
$$;

revoke all on function public.novelight_admin_register_thumbnail_layer_asset(
  uuid, text, text, text, text, text, integer, text
) from public, anon, authenticated;
grant execute on function public.novelight_admin_register_thumbnail_layer_asset(
  uuid, text, text, text, text, text, integer, text
) to service_role;

create or replace function public.novelight_admin_set_thumbnail_asset_status(
  p_admin_user_id uuid,
  p_asset_id uuid,
  p_status text
)
returns setof public.novel_thumbnail_assets
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.novel_thumbnail_assets%rowtype;
  v_status text := trim(coalesce(p_status, ''));
begin
  if p_admin_user_id is null or p_asset_id is null then
    raise exception using errcode = '22023', message = 'Admin identity and asset are required';
  end if;
  if v_status not in ('active','retired','emergency_disabled') then
    raise exception using errcode = '22023', message = 'Thumbnail status is invalid';
  end if;

  update public.novel_thumbnail_assets
     set availability_status = v_status,
         is_active = v_status = 'active'
   where id = p_asset_id
  returning * into v_row;

  if not found then
    raise exception using errcode = 'P0002', message = 'Thumbnail asset not found';
  end if;

  if v_row.layer_type = 'cover_mask' and v_status <> 'active' then
    update public.novel_thumbnail_templates
       set cover_mask_storage_path = null,
           cover_mask_url = null,
           updated_at = now()
     where template_key = v_row.template_key
       and cover_mask_storage_path = v_row.storage_path;
  elsif v_row.layer_type = 'cover_mask' and v_status = 'active' then
    update public.novel_thumbnail_templates
       set cover_mask_storage_path = v_row.storage_path,
           cover_mask_url = v_row.image_url,
           updated_at = now()
     where template_key = v_row.template_key;
  end if;

  insert into public.admin_operation_audit (
    admin_user_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) values (
    p_admin_user_id,
    'thumbnail.layer.status',
    'novel_thumbnail_asset',
    v_row.id::text,
    jsonb_build_object('status', v_status)
  );

  return next v_row;
end;
$$;

revoke all on function public.novelight_admin_set_thumbnail_asset_status(
  uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.novelight_admin_set_thumbnail_asset_status(
  uuid, uuid, text
) to service_role;

-- Cached renders live separately from official source assets. Authors never
-- receive general INSERT/UPDATE policies; the server issues one-time signed upload tokens.
do $$
declare
  v_public boolean;
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage.buckets is unavailable; skipping render bucket bootstrap in compatibility replay';
    return;
  end if;

  insert into storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
  ) values (
    'novel-thumbnail-renders',
    'novel-thumbnail-renders',
    true,
    2097152,
    array['image/webp']
  )
  on conflict (id) do nothing;

  select public into v_public
    from storage.buckets
   where id = 'novel-thumbnail-renders';

  if v_public is distinct from true then
    raise exception 'Existing novel-thumbnail-renders bucket is not public; inspect before continuing';
  end if;
end
$$;

commit;
