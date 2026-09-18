-- NOVELIGHT competitor audit B #11: author defaults and per-work reception controls.
-- Comments and typo reports are interaction preferences only. They must not alter
-- Rank, LIGHT SEED, SCOUT scoring, PV, favorites, or exposure allocation.
-- Existing typo-report settings stay authoritative and are extended with explicit
-- inheritance instead of creating a second typo preference model.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260918164000'));

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.novels') is null
     or to_regclass('public.novel_comments') is null
     or to_regclass('public.novel_typo_report_settings') is null
     or to_regprocedure('public.post_novel_comment(text,text)') is null
     or to_regprocedure('public.novelight_author_typo_report_settings(bigint)') is null
     or to_regprocedure('public.novelight_set_novel_typo_reports_enabled(bigint,boolean)') is null then
    raise exception 'Interaction foundations are required';
  end if;

  if to_regclass('public.author_interaction_defaults') is not null
     or to_regclass('public.novel_comment_reception_settings') is not null
     or to_regprocedure('public.novelight_author_interaction_defaults()') is not null
     or to_regprocedure('public.novelight_set_author_interaction_defaults(boolean,boolean)') is not null
     or to_regprocedure('public.novelight_author_novel_interaction_settings(bigint)') is not null
     or to_regprocedure('public.novelight_set_novel_interaction_settings(bigint,boolean,boolean)') is not null
     or to_regprocedure('public.novelight_novel_comment_reception_state(bigint)') is not null
     or to_regprocedure('public._novelight_enforce_comment_reception()') is not null
     or to_regprocedure('public._novelight_seed_typo_reception_for_novel()') is not null then
    raise exception 'Interaction reception runtime is already installed';
  end if;
end
$$;

alter table public.novel_typo_report_settings
  add column inherits_author_default boolean not null default false;

comment on column public.novel_typo_report_settings.inherits_author_default is
  'True only when the stored enabled value mirrors the author interaction default.';

create table public.author_interaction_defaults (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  comments_enabled boolean not null default true,
  typo_reports_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.novel_comment_reception_settings (
  novel_id bigint primary key references public.novels(id) on delete cascade,
  enabled boolean not null,
  updated_at timestamptz not null default now()
);

comment on table public.author_interaction_defaults is
  'Private author reception defaults. Never an evaluation, Rank, LIGHT SEED, SCOUT, discovery, or exposure signal.';
comment on table public.novel_comment_reception_settings is
  'Private per-work comment reception override. Row absence means inherit the author default.';

alter table public.author_interaction_defaults enable row level security;
alter table public.novel_comment_reception_settings enable row level security;

revoke all on table public.author_interaction_defaults from public, anon, authenticated;
revoke all on table public.novel_comment_reception_settings from public, anon, authenticated;

insert into public.novel_typo_report_settings (
  novel_id,
  enabled,
  inherits_author_default,
  updated_at
)
select
  n.id,
  coalesce(d.typo_reports_enabled, false),
  true,
  pg_catalog.now()
from public.novels n
left join public.author_interaction_defaults d on d.user_id = n.user_id
left join public.novel_typo_report_settings s on s.novel_id = n.id
where s.novel_id is null;

create function public.novelight_author_interaction_defaults()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_comments_enabled boolean := true;
  v_typo_reports_enabled boolean := false;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  select d.comments_enabled, d.typo_reports_enabled
    into v_comments_enabled, v_typo_reports_enabled
    from public.author_interaction_defaults d
   where d.user_id = v_uid;

  if not found then
    v_comments_enabled := true;
    v_typo_reports_enabled := false;
  end if;

  return pg_catalog.jsonb_build_object(
    'comments_enabled', v_comments_enabled,
    'typo_reports_enabled', v_typo_reports_enabled
  );
end
$$;

create function public.novelight_set_author_interaction_defaults(
  p_comments_enabled boolean,
  p_typo_reports_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if p_comments_enabled is null or p_typo_reports_enabled is null then
    raise exception using errcode = '22023', message = 'Interaction defaults must be boolean values';
  end if;

  perform 1
    from public.profiles p
   where p.id = v_uid
   for update;

  if not found then
    raise exception using errcode = '42501', message = 'Profile not found';
  end if;

  insert into public.author_interaction_defaults (
    user_id,
    comments_enabled,
    typo_reports_enabled,
    updated_at
  )
  values (
    v_uid,
    p_comments_enabled,
    p_typo_reports_enabled,
    pg_catalog.now()
  )
  on conflict (user_id) do update
    set comments_enabled = excluded.comments_enabled,
        typo_reports_enabled = excluded.typo_reports_enabled,
        updated_at = pg_catalog.now();

  insert into public.novel_typo_report_settings (
    novel_id,
    enabled,
    inherits_author_default,
    updated_at
  )
  select n.id, p_typo_reports_enabled, true, pg_catalog.now()
    from public.novels n
   where n.user_id = v_uid
     and not exists (
       select 1
         from public.novel_typo_report_settings s
        where s.novel_id = n.id
     )
  on conflict (novel_id) do nothing;

  update public.novel_typo_report_settings s
     set enabled = p_typo_reports_enabled,
         updated_at = pg_catalog.now()
    from public.novels n
   where n.id = s.novel_id
     and n.user_id = v_uid
     and s.inherits_author_default = true;

  return public.novelight_author_interaction_defaults();
end
$$;

create function public.novelight_author_novel_interaction_settings(p_novel_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_author_id uuid;
  v_comments_default boolean := true;
  v_typo_default boolean := false;
  v_comments_override boolean;
  v_typo_enabled boolean := false;
  v_typo_inherits boolean := true;
  v_typo_override boolean;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  select n.user_id
    into v_author_id
    from public.novels n
   where n.id = p_novel_id
     and n.user_id = v_uid;

  if not found then
    raise exception using errcode = '42501', message = 'Owned novel not found';
  end if;

  select d.comments_enabled, d.typo_reports_enabled
    into v_comments_default, v_typo_default
    from public.author_interaction_defaults d
   where d.user_id = v_author_id;

  if not found then
    v_comments_default := true;
    v_typo_default := false;
  end if;

  select s.enabled
    into v_comments_override
    from public.novel_comment_reception_settings s
   where s.novel_id = p_novel_id;

  select s.enabled, s.inherits_author_default
    into v_typo_enabled, v_typo_inherits
    from public.novel_typo_report_settings s
   where s.novel_id = p_novel_id;

  if not found then
    v_typo_enabled := v_typo_default;
    v_typo_inherits := true;
  end if;

  if v_typo_inherits then
    v_typo_override := null;
  else
    v_typo_override := v_typo_enabled;
  end if;

  return pg_catalog.jsonb_build_object(
    'comments_default', v_comments_default,
    'comments_override', v_comments_override,
    'comments_effective', coalesce(v_comments_override, v_comments_default, true),
    'typo_reports_default', v_typo_default,
    'typo_reports_override', v_typo_override,
    'typo_reports_effective', v_typo_enabled
  );
end
$$;

create function public.novelight_set_novel_interaction_settings(
  p_novel_id bigint,
  p_comments_enabled boolean,
  p_typo_reports_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_typo_default boolean := false;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  perform 1
    from public.novels n
   where n.id = p_novel_id
     and n.user_id = v_uid
   for update;

  if not found then
    raise exception using errcode = '42501', message = 'Owned novel not found';
  end if;

  select d.typo_reports_enabled
    into v_typo_default
    from public.author_interaction_defaults d
   where d.user_id = v_uid;

  if not found then
    v_typo_default := false;
  end if;

  if p_comments_enabled is null then
    delete from public.novel_comment_reception_settings s
     where s.novel_id = p_novel_id;
  else
    insert into public.novel_comment_reception_settings (
      novel_id,
      enabled,
      updated_at
    )
    values (
      p_novel_id,
      p_comments_enabled,
      pg_catalog.now()
    )
    on conflict (novel_id) do update
      set enabled = excluded.enabled,
          updated_at = pg_catalog.now();
  end if;

  if p_typo_reports_enabled is null then
    insert into public.novel_typo_report_settings (
      novel_id,
      enabled,
      inherits_author_default,
      updated_at
    )
    values (
      p_novel_id,
      v_typo_default,
      true,
      pg_catalog.now()
    )
    on conflict (novel_id) do update
      set enabled = excluded.enabled,
          inherits_author_default = true,
          updated_at = pg_catalog.now();
  else
    insert into public.novel_typo_report_settings (
      novel_id,
      enabled,
      inherits_author_default,
      updated_at
    )
    values (
      p_novel_id,
      p_typo_reports_enabled,
      false,
      pg_catalog.now()
    )
    on conflict (novel_id) do update
      set enabled = excluded.enabled,
          inherits_author_default = false,
          updated_at = pg_catalog.now();
  end if;

  return public.novelight_author_novel_interaction_settings(p_novel_id);
end
$$;

create function public.novelight_novel_comment_reception_state(p_novel_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comments_enabled boolean;
begin
  select coalesce(s.enabled, d.comments_enabled, true)
    into v_comments_enabled
    from public.novels n
    left join public.novel_comment_reception_settings s on s.novel_id = n.id
    left join public.author_interaction_defaults d on d.user_id = n.user_id
   where n.id = p_novel_id
     and n.status = 'published';

  if not found then
    return pg_catalog.jsonb_build_object('comments_enabled', false);
  end if;

  return pg_catalog.jsonb_build_object('comments_enabled', v_comments_enabled);
end
$$;

create function public._novelight_enforce_comment_reception()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comments_enabled boolean;
begin
  select coalesce(s.enabled, d.comments_enabled, true)
    into v_comments_enabled
    from public.novels n
    left join public.novel_comment_reception_settings s on s.novel_id = n.id
    left join public.author_interaction_defaults d on d.user_id = n.user_id
   where n.id = new.novel_id;

  if not found then
    raise exception using errcode = '23503', message = 'Novel not found';
  end if;

  if not v_comments_enabled then
    raise exception using errcode = '23514', message = 'COMMENTS_DISABLED';
  end if;

  return new;
end
$$;

create trigger novelight_enforce_comment_reception
before insert on public.novel_comments
for each row
execute function public._novelight_enforce_comment_reception();

create function public._novelight_seed_typo_reception_for_novel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_default boolean := false;
begin
  select d.typo_reports_enabled
    into v_default
    from public.author_interaction_defaults d
   where d.user_id = new.user_id;

  if not found then
    v_default := false;
  end if;

  insert into public.novel_typo_report_settings (
    novel_id,
    enabled,
    inherits_author_default,
    updated_at
  )
  values (
    new.id,
    v_default,
    true,
    pg_catalog.now()
  )
  on conflict (novel_id) do nothing;

  return new;
end
$$;

create trigger novelight_seed_typo_reception_for_novel
after insert on public.novels
for each row
execute function public._novelight_seed_typo_reception_for_novel();

create or replace function public.novelight_set_novel_typo_reports_enabled(
  p_novel_id bigint,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_enabled is null then
    raise exception using errcode = '22023', message = 'Enabled state is required';
  end if;

  perform 1
    from public.novels n
   where n.id = p_novel_id
     and n.user_id = v_uid
   for update;

  if not found then
    raise exception using errcode = '42501', message = 'Owned novel not found';
  end if;

  insert into public.novel_typo_report_settings (
    novel_id,
    enabled,
    inherits_author_default,
    updated_at
  )
  values (
    p_novel_id,
    p_enabled,
    false,
    pg_catalog.now()
  )
  on conflict (novel_id) do update
    set enabled = excluded.enabled,
        inherits_author_default = false,
        updated_at = pg_catalog.now();

  return public.novelight_author_typo_report_settings(p_novel_id);
end
$$;

revoke all on function public.novelight_author_interaction_defaults()
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_set_author_interaction_defaults(boolean, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_author_novel_interaction_settings(bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_set_novel_interaction_settings(bigint, boolean, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_novel_comment_reception_state(bigint)
  from public, anon, authenticated, service_role;
revoke all on function public._novelight_enforce_comment_reception()
  from public, anon, authenticated, service_role;
revoke all on function public._novelight_seed_typo_reception_for_novel()
  from public, anon, authenticated, service_role;

grant execute on function public.novelight_author_interaction_defaults()
  to authenticated, service_role;
grant execute on function public.novelight_set_author_interaction_defaults(boolean, boolean)
  to authenticated, service_role;
grant execute on function public.novelight_author_novel_interaction_settings(bigint)
  to authenticated, service_role;
grant execute on function public.novelight_set_novel_interaction_settings(bigint, boolean, boolean)
  to authenticated, service_role;
grant execute on function public.novelight_novel_comment_reception_state(bigint)
  to anon, authenticated, service_role;

commit;
