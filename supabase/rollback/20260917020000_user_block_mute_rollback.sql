-- Rollback for 20260917020000_user_block_mute.sql.
-- Restore the pre-block/mute Chapter 38 comment behavior before dropping safety objects.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260917020000:rollback'));

create or replace function public.novelight_comment_feed(
  p_novel_id text,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_novel_id bigint;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_uid uuid := (select auth.uid());
  v_result jsonb;
begin
  select n.id
    into v_novel_id
    from public.novels n
   where n.id::text = p_novel_id
     and n.status = 'published';

  if not found then
    return '[]'::jsonb;
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', q.id,
        'user_id', q.user_id,
        'display_name', q.display_name,
        'body', q.body,
        'created_at', q.created_at,
        'can_delete', q.user_id = v_uid
      ) order by q.created_at desc, q.id desc
    ),
    '[]'::jsonb
  )
    into v_result
    from (
      select c.id, c.user_id, p.display_name, c.body, c.created_at
        from public.novel_comments c
        join public.profiles p on p.id = c.user_id
       where c.novel_id = v_novel_id
         and c.deleted_at is null
       order by c.created_at desc, c.id desc
       limit v_limit
    ) q;

  return v_result;
end
$$;

create or replace function public.post_novel_comment(
  p_novel_id text,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_novel_id bigint;
  v_author_id uuid;
  v_is_self_comment boolean := false;
  v_body text := pg_catalog.btrim(coalesce(p_body, ''));
  v_comment_id uuid := pg_catalog.gen_random_uuid();
  v_event_id uuid := pg_catalog.gen_random_uuid();
  v_event_at timestamptz := pg_catalog.now();
  v_had_work_today boolean := false;
  v_awarded_today integer := 0;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if pg_catalog.char_length(v_body) < 1 or pg_catalog.char_length(v_body) > 2000 then
    raise exception using errcode = '22023', message = 'コメントは1文字以上2000文字以内で入力してください';
  end if;

  select n.id, n.user_id
    into v_novel_id, v_author_id
    from public.novels n
   where n.id::text = p_novel_id
     and n.status = 'published';

  if not found then
    raise exception using errcode = '23514', message = '公開作品が見つかりません';
  end if;

  v_is_self_comment := v_author_id = v_uid;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('novelight:comment-xp:' || v_uid::text, 0)
  );

  if not v_is_self_comment then
    select exists (
      select 1
        from public.scout_event_ledger e
       where e.user_id = v_uid
         and e.novel_id_snapshot = p_novel_id
         and e.event_type = 'comment_posted'
         and coalesce(e.metadata ->> 'xp_eligible', 'true') = 'true'
         and pg_catalog.timezone('Asia/Tokyo', e.occurred_at)::date
             = pg_catalog.timezone('Asia/Tokyo', v_event_at)::date
    ) into v_had_work_today;
  end if;

  insert into public.novel_comments (
    id,
    novel_id,
    user_id,
    body,
    created_at
  ) values (
    v_comment_id,
    v_novel_id,
    v_uid,
    v_body,
    v_event_at
  );

  insert into public.scout_event_ledger (
    id,
    user_id,
    event_type,
    event_key,
    novel_id_snapshot,
    occurred_at,
    metadata
  ) values (
    v_event_id,
    v_uid,
    'comment_posted',
    'comment_posted:' || v_comment_id::text,
    p_novel_id,
    v_event_at,
    pg_catalog.jsonb_build_object(
      'comment_id', v_comment_id,
      'novel_author_id', v_author_id,
      'xp_eligible', not v_is_self_comment
    )
  );

  if not v_is_self_comment and not v_had_work_today then
    select count(*)::integer
      into v_awarded_today
      from public.scout_xp_ledger x
     where x.user_id = v_uid
       and x.xp_kind = 'comment'
       and pg_catalog.timezone('Asia/Tokyo', x.occurred_at)::date
           = pg_catalog.timezone('Asia/Tokyo', v_event_at)::date;

    if v_awarded_today < 3 then
      insert into public.scout_xp_ledger (
        user_id,
        source_event_id,
        xp_kind,
        xp_value,
        rule_version,
        occurred_at
      ) values (
        v_uid,
        v_event_id,
        'comment',
        5,
        'beta-v1',
        v_event_at
      )
      on conflict (user_id, source_event_id, xp_kind) do nothing;
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'id', v_comment_id,
    'created_at', v_event_at
  );
end
$$;

revoke all on function public.novelight_comment_feed(text, integer) from public;
revoke all on function public.post_novel_comment(text, text) from public, anon;
grant execute on function public.novelight_comment_feed(text, integer) to anon, authenticated;
grant execute on function public.post_novel_comment(text, text) to authenticated;

drop function if exists public.novelight_hidden_novel_ids(text[]);
drop function if exists public.novelight_set_user_mute(uuid, boolean);
drop function if exists public.novelight_set_user_block(uuid, boolean);
drop function if exists public.novelight_user_relationship(uuid);
drop table if exists public.user_mutes;
drop table if exists public.user_blocks;

commit;
