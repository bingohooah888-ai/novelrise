-- NOVELIGHT beta: single scheduled episode publication.
-- One draft episode per novel may be scheduled at a time.

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260916114500'));

create extension if not exists pg_cron with schema pg_catalog;

alter table public.episodes
  add column scheduled_publish_at timestamptz,
  add column scheduled_publish_error text;

create unique index episodes_one_scheduled_draft_per_novel_idx
  on public.episodes (novel_id)
  where status = 'draft' and scheduled_publish_at is not null;

create index episodes_scheduled_publish_due_idx
  on public.episodes (scheduled_publish_at, id)
  where status = 'draft' and scheduled_publish_at is not null;

create function public.novelight_schedule_episode_publication(
  p_episode_id bigint,
  p_publish_at timestamptz
)
returns bigint
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_novel_id bigint;
  v_episode_number bigint;
  v_episode_status text;
  v_title text;
  v_content text;
  v_novel_status text;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_publish_at is null or p_publish_at <= now() then
    raise exception 'Scheduled publication time must be in the future' using errcode = '22023';
  end if;

  select e.novel_id,
         e.episode_number,
         e.status,
         e.title,
         e.content,
         n.status
  into v_novel_id,
       v_episode_number,
       v_episode_status,
       v_title,
       v_content,
       v_novel_status
  from public.episodes e
  join public.novels n on n.id = e.novel_id
  where e.id = p_episode_id
    and e.user_id = v_user_id
    and n.user_id = v_user_id
  for update of e, n;

  if not found then
    raise exception 'Draft episode not found or not owned by current user' using errcode = '42501';
  end if;
  if v_episode_status <> 'draft' then
    raise exception 'Only draft episodes can be scheduled' using errcode = '22023';
  end if;
  if v_episode_number is null or v_episode_number < 1 then
    raise exception 'A valid episode number is required before scheduling' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(v_title, ''))) < 1 or char_length(v_title) > 150 then
    raise exception 'Episode title must contain 1 to 150 characters before scheduling' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(v_content, ''))) < 1 or char_length(v_content) > 100000 then
    raise exception 'Episode content must contain 1 to 100000 characters before scheduling' using errcode = '22023';
  end if;
  if v_novel_status <> 'published' and v_episode_number <> 1 then
    raise exception 'The first scheduled publication must be episode 1' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.episodes other
    where other.novel_id = v_novel_id
      and other.status = 'draft'
      and other.scheduled_publish_at is not null
      and other.id <> p_episode_id
  ) then
    raise exception 'Only one episode per novel can be scheduled at a time' using errcode = '23505';
  end if;

  update public.episodes
  set scheduled_publish_at = p_publish_at,
      scheduled_publish_error = null
  where id = p_episode_id
    and user_id = v_user_id
    and status = 'draft';

  if not found then
    raise exception 'Draft episode schedule raced with another update' using errcode = '40001';
  end if;

  return p_episode_id;
end
$$;

create function public.novelight_cancel_episode_schedule(
  p_episode_id bigint
)
returns bigint
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  update public.episodes e
  set scheduled_publish_at = null,
      scheduled_publish_error = null
  where e.id = p_episode_id
    and e.user_id = v_user_id
    and e.status = 'draft'
    and exists (
      select 1
      from public.novels n
      where n.id = e.novel_id
        and n.user_id = v_user_id
    );

  if not found then
    raise exception 'Scheduled draft episode not found or not owned by current user' using errcode = '42501';
  end if;

  return p_episode_id;
end
$$;

create function public.novelight_publish_due_episodes()
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_episode record;
  v_novel_status text;
  v_published integer := 0;
  v_error text;
begin
  for v_episode in
    select e.id,
           e.novel_id,
           e.user_id,
           e.episode_number,
           e.title,
           e.content
    from public.episodes e
    where e.status = 'draft'
      and e.scheduled_publish_at is not null
      and e.scheduled_publish_at <= now()
    order by e.scheduled_publish_at asc, e.id asc
    for update skip locked
  loop
    v_error := null;

    select n.status
      into v_novel_status
    from public.novels n
    where n.id = v_episode.novel_id
      and n.user_id = v_episode.user_id
    for update;

    if not found then
      v_error := '作品情報を確認できなかったため予約公開できませんでした。';
    elsif v_episode.episode_number is null or v_episode.episode_number < 1 then
      v_error := '話数を確認できなかったため予約公開できませんでした。';
    elsif char_length(trim(coalesce(v_episode.title, ''))) < 1 or char_length(v_episode.title) > 150 then
      v_error := 'タイトルを確認して予約公開を再設定してください。';
    elsif char_length(trim(coalesce(v_episode.content, ''))) < 1 or char_length(v_episode.content) > 100000 then
      v_error := '本文を確認して予約公開を再設定してください。';
    elsif v_novel_status <> 'published' and v_episode.episode_number <> 1 then
      v_error := '初回公開は第1話として予約してください。';
    end if;

    if v_error is not null then
      update public.episodes
      set scheduled_publish_at = null,
          scheduled_publish_error = v_error
      where id = v_episode.id
        and status = 'draft';
      continue;
    end if;

    if v_novel_status <> 'published' then
      update public.novels
      set status = 'published'
      where id = v_episode.novel_id
        and user_id = v_episode.user_id;

      if not found then
        update public.episodes
        set scheduled_publish_at = null,
            scheduled_publish_error = '作品を公開できなかったため予約を解除しました。'
        where id = v_episode.id
          and status = 'draft';
        continue;
      end if;
    end if;

    update public.episodes
    set status = 'published',
        scheduled_publish_at = null,
        scheduled_publish_error = null
    where id = v_episode.id
      and status = 'draft';

    if found then
      v_published := v_published + 1;
    end if;
  end loop;

  return v_published;
end
$$;

revoke all on function public.novelight_schedule_episode_publication(bigint,timestamptz) from public;
revoke all on function public.novelight_schedule_episode_publication(bigint,timestamptz) from anon;
grant execute on function public.novelight_schedule_episode_publication(bigint,timestamptz) to authenticated;

revoke all on function public.novelight_cancel_episode_schedule(bigint) from public;
revoke all on function public.novelight_cancel_episode_schedule(bigint) from anon;
grant execute on function public.novelight_cancel_episode_schedule(bigint) to authenticated;

revoke all on function public.novelight_publish_due_episodes() from public;
revoke all on function public.novelight_publish_due_episodes() from anon;
revoke all on function public.novelight_publish_due_episodes() from authenticated;

-- A fixed name keeps the job observable and prevents duplicate schedulers.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'novelight-publish-due-episodes') then
    raise exception 'Cron job novelight-publish-due-episodes already exists; stop and inspect before applying';
  end if;
end
$$;

select cron.schedule(
  'novelight-publish-due-episodes',
  '* * * * *',
  'select public.novelight_publish_due_episodes();'
);

commit;
