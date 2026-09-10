-- NOVELIGHT Chapter 38: self-comments never award SCOUT EXP.
--
-- This migration hardens the comment EXP runtime and rebuilds the derived
-- beta-v1 comment XP ledger from raw comment_posted evidence so a self-comment
-- cannot consume one of the three rewarded works for the JST day.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260910143000'));

do $$
begin
  if to_regclass('public.novel_comments') is null
     or to_regclass('public.scout_event_ledger') is null
     or to_regclass('public.scout_xp_ledger') is null
     or to_regclass('public.novels') is null
     or to_regprocedure('public.post_novel_comment(text,text)') is null then
    raise exception 'Chapter 38 comment SCOUT EXP foundation is required';
  end if;

  if exists (
    select 1
      from public.scout_xp_ledger x
     where x.xp_kind = 'comment'
       and x.rule_version <> 'beta-v1'
  ) then
    raise exception 'Unexpected non-beta-v1 comment XP requires manual reconciliation';
  end if;
end
$$;

-- Rebuild derived comment XP from raw evidence under the corrected rule.
-- Existing raw events did not snapshot the author id, so for those events the
-- current novel owner is used when the novel still exists. New events snapshot
-- both author id and eligibility in metadata so later replay remains stable.
delete from public.scout_xp_ledger x
 where x.xp_kind = 'comment'
   and x.rule_version = 'beta-v1';

with eligible_events as (
  select
    e.id as source_event_id,
    e.user_id,
    e.novel_id_snapshot,
    e.occurred_at,
    case
      when e.metadata ? 'xp_eligible' then e.metadata ->> 'xp_eligible' = 'true'
      when n.id is not null then e.user_id is distinct from n.user_id
      else true
    end as xp_eligible
  from public.scout_event_ledger e
  left join public.novels n on n.id::text = e.novel_id_snapshot
  where e.event_type = 'comment_posted'
    and e.user_id is not null
    and e.novel_id_snapshot is not null
),
first_work_day as (
  select
    e.source_event_id,
    e.user_id,
    e.novel_id_snapshot,
    e.occurred_at,
    row_number() over (
      partition by
        e.user_id,
        e.novel_id_snapshot,
        pg_catalog.timezone('Asia/Tokyo', e.occurred_at)::date
      order by e.occurred_at, e.source_event_id
    ) as work_day_order
  from eligible_events e
  where e.xp_eligible
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

  -- Serialize one reader's comment actions so same-work/day eligibility and the
  -- three-work daily cap cannot race across simultaneous requests.
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

revoke all on function public.post_novel_comment(text, text) from public, anon;
grant execute on function public.post_novel_comment(text, text) to authenticated;

commit;
