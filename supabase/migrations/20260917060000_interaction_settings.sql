-- NOVELIGHT competitor audit item #11: author defaults and per-work interaction settings.
--
-- Interaction preferences are reception controls only. They must never alter
-- Rank, LIGHT SEED, SCOUT scoring, PV, favorites, or exposure allocation.
-- Raw settings stay private; readers receive only the effective comment state.
-- Typo-report preferences are stored for the later typo-report workflow, but
-- this migration deliberately does not create a reader typo-report endpoint.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260917060000'));

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.novels') is null
     or to_regclass('public.novel_comments') is null then
    raise exception 'Profile, novel, and comment foundations are required';
  end if;

  if to_regclass('public.author_interaction_defaults') is not null
     or to_regclass('public.novel_interaction_settings') is not null
     or to_regprocedure('public.novelight_author_interaction_defaults()') is not null
     or to_regprocedure('public.novelight_set_author_interaction_defaults(boolean,boolean)') is not null
     or to_regprocedure('public.novelight_author_novel_interaction_settings(text)') is not null
     or to_regprocedure('public.novelight_set_novel_interaction_settings(text,boolean,boolean)') is not null
     or to_regprocedure('public.novelight_novel_interaction_state(text)') is not null
     or to_regprocedure('public._novelight_enforce_comment_reception()') is not null then
    raise exception 'Interaction settings runtime is already installed';
  end if;

  if exists (
    select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'novel_comments'
       and t.tgname = 'novelight_enforce_comment_reception'
       and not t.tgisinternal
  ) then
    raise exception 'Comment reception trigger already exists';
  end if;
end
$$;

create table public.author_interaction_defaults (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  comments_enabled boolean not null default true,
  typo_reports_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.novel_interaction_settings (
  novel_id bigint primary key references public.novels(id) on delete cascade,
  comments_enabled boolean,
  typo_reports_enabled boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.author_interaction_defaults enable row level security;
alter table public.novel_interaction_settings enable row level security;

revoke all on table public.author_interaction_defaults from public, anon, authenticated;
revoke all on table public.novel_interaction_settings from public, anon, authenticated;

create policy author_interaction_defaults_owner_all
  on public.author_interaction_defaults
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy novel_interaction_settings_owner_all
  on public.novel_interaction_settings
  for all
  to authenticated
  using (
    exists (
      select 1
        from public.novels n
       where n.id = novel_interaction_settings.novel_id
         and n.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
        from public.novels n
       where n.id = novel_interaction_settings.novel_id
         and n.user_id = (select auth.uid())
    )
  );

create function public.novelight_author_interaction_defaults()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
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
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if p_comments_enabled is null or p_typo_reports_enabled is null then
    raise exception using errcode = '22023', message = 'Interaction defaults must be boolean values';
  end if;

  insert into public.author_interaction_defaults (
    user_id,
    comments_enabled,
    typo_reports_enabled,
    updated_at
  ) values (
    v_uid,
    p_comments_enabled,
    p_typo_reports_enabled,
    pg_catalog.now()
  )
  on conflict (user_id) do update
    set comments_enabled = excluded.comments_enabled,
        typo_reports_enabled = excluded.typo_reports_enabled,
        updated_at = pg_catalog.now();

  return pg_catalog.jsonb_build_object(
    'comments_enabled', p_comments_enabled,
    'typo_reports_enabled', p_typo_reports_enabled
  );
end
$$;

create function public.novelight_author_novel_interaction_settings(p_novel_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_novel_id bigint;
  v_comments_default boolean := true;
  v_typo_default boolean := false;
  v_comments_override boolean;
  v_typo_override boolean;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  select n.id
    into v_novel_id
    from public.novels n
   where n.id::text = p_novel_id
     and n.user_id = v_uid;

  if not found then
    raise exception using errcode = '42501', message = 'Owned novel not found';
  end if;

  select d.comments_enabled, d.typo_reports_enabled
    into v_comments_default, v_typo_default
    from public.author_interaction_defaults d
   where d.user_id = v_uid;

  if not found then
    v_comments_default := true;
    v_typo_default := false;
  end if;

  select s.comments_enabled, s.typo_reports_enabled
    into v_comments_override, v_typo_override
    from public.novel_interaction_settings s
   where s.novel_id = v_novel_id;

  return pg_catalog.jsonb_build_object(
    'comments_default', v_comments_default,
    'comments_override', v_comments_override,
    'comments_effective', coalesce(v_comments_override, v_comments_default, true),
    'typo_reports_default', v_typo_default,
    'typo_reports_override', v_typo_override,
    'typo_reports_effective_preference', coalesce(v_typo_override, v_typo_default, false),
    'typo_reports_live', false
  );
end
$$;

create function public.novelight_set_novel_interaction_settings(
  p_novel_id text,
  p_comments_enabled boolean,
  p_typo_reports_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_novel_id bigint;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  select n.id
    into v_novel_id
    from public.novels n
   where n.id::text = p_novel_id
     and n.user_id = v_uid
   for update;

  if not found then
    raise exception using errcode = '42501', message = 'Owned novel not found';
  end if;

  if p_comments_enabled is null and p_typo_reports_enabled is null then
    delete from public.novel_interaction_settings s
     where s.novel_id = v_novel_id;
  else
    insert into public.novel_interaction_settings (
      novel_id,
      comments_enabled,
      typo_reports_enabled,
      updated_at
    ) values (
      v_novel_id,
      p_comments_enabled,
      p_typo_reports_enabled,
      pg_catalog.now()
    )
    on conflict (novel_id) do update
      set comments_enabled = excluded.comments_enabled,
          typo_reports_enabled = excluded.typo_reports_enabled,
          updated_at = pg_catalog.now();
  end if;

  return public.novelight_author_novel_interaction_settings(p_novel_id);
end
$$;

create function public.novelight_novel_interaction_state(p_novel_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comments_enabled boolean;
begin
  select coalesce(s.comments_enabled, d.comments_enabled, true)
    into v_comments_enabled
    from public.novels n
    left join public.novel_interaction_settings s on s.novel_id = n.id
    left join public.author_interaction_defaults d on d.user_id = n.user_id
   where n.id::text = p_novel_id
     and n.status = 'published';

  if not found then
    return pg_catalog.jsonb_build_object('comments_enabled', false);
  end if;

  -- Typo-report preferences intentionally remain private until the dedicated
  -- typo-report workflow exists. Do not advertise a reader action prematurely.
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
  select coalesce(s.comments_enabled, d.comments_enabled, true)
    into v_comments_enabled
    from public.novels n
    left join public.novel_interaction_settings s on s.novel_id = n.id
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

revoke all on function public.novelight_author_interaction_defaults() from public, anon;
grant execute on function public.novelight_author_interaction_defaults() to authenticated;

revoke all on function public.novelight_set_author_interaction_defaults(boolean, boolean) from public, anon;
grant execute on function public.novelight_set_author_interaction_defaults(boolean, boolean) to authenticated;

revoke all on function public.novelight_author_novel_interaction_settings(text) from public, anon;
grant execute on function public.novelight_author_novel_interaction_settings(text) to authenticated;

revoke all on function public.novelight_set_novel_interaction_settings(text, boolean, boolean) from public, anon;
grant execute on function public.novelight_set_novel_interaction_settings(text, boolean, boolean) to authenticated;

revoke all on function public.novelight_novel_interaction_state(text) from public;
grant execute on function public.novelight_novel_interaction_state(text) to anon, authenticated;

revoke all on function public._novelight_enforce_comment_reception() from public, anon, authenticated;

commit;
