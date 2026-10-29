-- Surface existing opt-in public title and public avatar only for comments visible in the scoped feed.
-- Preserve the existing published work, hidden comment, block/mute, and reply visibility checks.
begin;

create or replace function public.novelight_comment_feed_scope(
  p_novel_id bigint,
  p_episode_id bigint,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author_id uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_uid uuid := (select auth.uid());
  v_result jsonb;
begin
  select n.user_id
    into v_author_id
    from public.novels n
   where n.id = p_novel_id
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
        'avatar_path', q.avatar_path,
        'scout_level', scout.scout_level,
        'equipped_badge_id', equipped.badge_id,
        'equipped_badge_name', equipped.display_name,
        'body', q.body,
        'created_at', q.created_at,
        'can_delete', q.user_id = v_uid,
        'can_moderate', v_uid = v_author_id and q.user_id <> v_author_id,
        'is_pinned', q.pinned_at is not null and q.author_hidden_at is null,
        'is_hidden', q.author_hidden_at is not null,
        'is_spoiler', q.is_spoiler,
        'hidden_reason',
          case when v_uid = v_author_id then q.author_hidden_reason else null end,
        'author_reply_body',
          case when q.author_reply_visible then q.author_reply_body else null end,
        'author_reply_at',
          case when q.author_reply_visible then q.author_reply_at else null end,
        'author_reply_updated_at',
          case when q.author_reply_visible then q.author_reply_updated_at else null end
      )
      order by
        (q.pinned_at is not null and q.author_hidden_at is null) desc,
        q.pinned_at desc nulls last,
        q.created_at desc,
        q.id desc
    ),
    '[]'::jsonb
  )
    into v_result
    from (
      select
        c.id,
        c.user_id,
        p.display_name,
        p.avatar_path,
        c.body,
        c.created_at,
        c.author_hidden_at,
        c.author_hidden_reason,
        c.pinned_at,
        c.is_spoiler,
        c.author_reply_body,
        c.author_reply_at,
        c.author_reply_updated_at,
        case
          when c.author_reply_body is null then false
          when v_uid is null or v_uid = v_author_id then true
          when exists (
            select 1
              from public.user_blocks rb
             where (rb.blocker_user_id = v_uid and rb.blocked_user_id = v_author_id)
                or (rb.blocker_user_id = v_author_id and rb.blocked_user_id = v_uid)
          ) then false
          else true
        end as author_reply_visible
        from public.novel_comments c
        join public.profiles p on p.id = c.user_id
       where c.novel_id = p_novel_id
         and (
           (p_episode_id is null and c.episode_id is null)
           or c.episode_id = p_episode_id
         )
         and c.deleted_at is null
         and (
           c.author_hidden_at is null
           or v_uid = c.user_id
           or v_uid = v_author_id
         )
         and (
           v_uid is null
           or (
             not exists(
               select 1 from public.user_mutes m
                where m.muter_user_id = v_uid
                  and m.muted_user_id = c.user_id
             )
             and not exists(
               select 1 from public.user_blocks b
                where b.blocker_user_id = v_uid
                  and b.blocked_user_id = c.user_id
             )
           )
         )
       order by
         (c.pinned_at is not null and c.author_hidden_at is null) desc,
         c.pinned_at desc nulls last,
         c.created_at desc,
         c.id desc
       limit v_limit
    ) q
    left join lateral (
      select public.novelight_scout_level_for_xp(
        least(coalesce(sum(x.xp_value), 0),
              coalesce((select t.cumulative_xp from public.scout_level_thresholds t where t.level = 30), 0))
      ) as scout_level
      from public.scout_xp_ledger x
     where x.user_id = q.user_id
    ) scout on true
    left join lateral (
      select b.badge_id,
        case when b.badge_id = 'limited_founding_author' and (b.metadata->>'founding_number') ~ '^[0-9]+$'
          then 'Founding Author #' || lpad((b.metadata->>'founding_number'), 3, '0')
          else d.display_name end as display_name
        from public.user_scout_badges b
        join public.scout_badge_definitions d on d.badge_id = b.badge_id
       where b.user_id = q.user_id and b.status = 'earned' and b.is_public and d.enabled
       order by d.sort_order, b.badge_id
       limit 1
    ) equipped on true;

  return v_result;
end
$$;

revoke all on function public.novelight_comment_feed_scope(bigint, bigint, integer)
  from public, anon, authenticated, service_role;

commit;
