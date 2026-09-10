-- Roll back the Chapter 38 self-comment SCOUT EXP exclusion.
-- Raw comment and scout_event_ledger evidence is preserved.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260910143000:rollback'));

-- Restore the previous derived beta-v1 comment XP rules from raw evidence.
delete from public.scout_xp_ledger x
 where x.xp_kind = 'comment'
   and x.rule_version = 'beta-v1';

with first_work_day as (
  select
    e.id as source_event_id,
    e.user_id,
    e.novel_id_snapshot,
    e.occurred_at,
    row_number() over (
      partition by
        e.user_id,
        e.novel_id_snapshot,
        pg_catalog.timezone('Asia/Tokyo', e.occurred_at)::date
      order by e.occurred_at, e.id
    ) as work_day_order
  from public.scout_event_ledger e
  where e.event_type = 'comment_posted'
    and e.user_id is not null
    and e.novel_id_snapshot is not null
),
daily_ranked as (
  select
    f.*,
    row_number() over (
      partition by
        f.user_id,
        pg_catalog.timezone('Asia/Tokyo', f.occurred_at)::date
      order by f.occurred_at, f.source_event_id
    ) as daily_order
  from first_work_day f
  where f.work_day_order = 1
)
insert into public.scout_xp_ledger (
  user_id,
  source_event_id,
  xp_kind,
  xp_value,
  rule_version,
  occurred_at
)
select
  d.user_id,
  d.source_event_id,
  'comment',
  5,
  'beta-v1',
  d.occurred_at
from daily_ranked d
where d.daily_order <= 3
on conflict (user_id, source_event_id, xp_kind) do nothing;

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

  select n.id
    into v_novel_id
    from public.novels n
   where n.id::text = p_novel_id
     and n.status = 'published';

  if not found then
    raise exception using errcode = '23514', message = '公開作品が見つかりません';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('novelight:comment-xp:' || v_uid::text, 0)
  );

  select exists (
    select 1
      from public.scout_event_ledger e
     where e.user_id = v_uid
       and e.novel_id_snapshot = p_novel_id
       and e.event_type = 'comment_posted'
       and pg_catalog.timezone('Asia/Tokyo', e.occurred_at)::date
           = pg_catalog.timezone('Asia/Tokyo', v_event_at)::date
  ) into v_had_work_today;

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
    pg_catalog.jsonb_build_object('comment_id', v_comment_id)
  );

  if not v_had_work_today then
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

revoke all on function public.post_novel_comment(text, text) from public, anon;
grant execute on function public.post_novel_comment(text, text) to authenticated;

commit;
