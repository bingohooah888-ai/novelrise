begin;

create table if not exists public.thumbnail_render_failures (
  id bigint generated always as identity primary key,
  novel_id bigint references public.novels(id) on delete set null,
  user_id uuid not null,
  revision uuid,
  stage text not null check (stage in ('render','prepare-upload','upload','finalize-upload','unknown')),
  error_code text,
  error_message text not null,
  attempts integer not null default 1 check (attempts between 1 and 10),
  user_agent text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists thumbnail_render_failures_open_novel_idx
  on public.thumbnail_render_failures (novel_id, created_at desc)
  where resolved_at is null;

create index if not exists thumbnail_render_failures_created_at_idx
  on public.thumbnail_render_failures (created_at desc);

alter table public.thumbnail_render_failures enable row level security;
revoke all on table public.thumbnail_render_failures from anon, authenticated;
grant select, insert, update on table public.thumbnail_render_failures to service_role;
grant usage, select on sequence public.thumbnail_render_failures_id_seq to service_role;

create or replace function public.novelight_set_my_thumbnail_composition(
  p_novel_id bigint,
  p_template_key text,
  p_background_asset_id uuid,
  p_base_book_asset_id uuid,
  p_cover_asset_id uuid,
  p_pattern_asset_id uuid default null::uuid,
  p_symbol_asset_id uuid default null::uuid,
  p_frame_asset_id uuid default null::uuid,
  p_effect_asset_id uuid default null::uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'auth'
as $function$
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
         and (
           a.layer_type = v_layer.layer_type
           or (
             v_layer.layer_type = 'symbol'
             and a.layer_type = 'pattern'
           )
         )
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
        -- Keep the last known-good cached image until the new revision is
        -- rendered and atomically attached. A transient render failure must
        -- never turn an existing thumbnail into a blank placeholder.
        render_storage_path = public.novel_thumbnail_compositions.render_storage_path,
        render_url = public.novel_thumbnail_compositions.render_url,
        rendered_at = public.novel_thumbnail_compositions.rendered_at,
        updated_at = now();

  update public.novels
     set thumbnail_asset_id = null,
         -- Preserve the old public cache while a replacement render is pending.
         thumbnail_url = coalesce(
           (select c.render_url
              from public.novel_thumbnail_compositions c
             where c.novel_id = p_novel_id),
           thumbnail_url
         )
   where id = p_novel_id
     and user_id = v_uid;

  return jsonb_build_object(
    'novel_id', p_novel_id,
    'template_key', v_template,
    'revision', v_revision
  );
end;
$function$;

create or replace function public.novelight_attach_thumbnail_render(
  p_novel_id bigint,
  p_revision uuid,
  p_storage_path text,
  p_render_url text
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  if p_novel_id is null
     or p_revision is null
     or p_storage_path !~ '^renders/[0-9]+/[0-9a-f-]{36}\.webp$'
     or p_render_url not like 'https://%'
  then
    raise exception using errcode = '22023', message = 'Invalid thumbnail render metadata';
  end if;

  update public.novel_thumbnail_compositions
     set render_storage_path = p_storage_path,
         render_url = p_render_url,
         rendered_at = now(),
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

  update public.thumbnail_render_failures
     set resolved_at = now()
   where novel_id = p_novel_id
     and resolved_at is null;

  return true;
end;
$function$;

commit;
