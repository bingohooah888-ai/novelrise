\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260918192000:rollback'));

do $$
begin
  if to_regclass('public.novel_comment_moderation_events') is not null
     and exists(select 1 from public.novel_comment_moderation_events limit 1) then
    raise exception 'ROLLBACK REFUSED: B #14 moderation audit events exist';
  end if;

  if to_regclass('public.novel_comments') is not null
     and exists (
       select 1
         from public.novel_comments
        where author_hidden_at is not null
           or author_hidden_reason is not null
           or pinned_at is not null
           or author_reply_body is not null
           or author_reply_at is not null
           or author_reply_updated_at is not null
        limit 1
     ) then
    raise exception 'ROLLBACK REFUSED: B #14 moderation state exists on comments';
  end if;
end
$$;

revoke all on function public.novelight_set_comment_pin(uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_set_comment_hidden(uuid, boolean, text)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_set_comment_author_reply(uuid, text)
  from public, anon, authenticated, service_role;

drop function if exists public.novelight_set_comment_pin(uuid, boolean);
drop function if exists public.novelight_set_comment_hidden(uuid, boolean, text);
drop function if exists public.novelight_set_comment_author_reply(uuid, text);

-- Restore the block/mute-aware comment feed that existed immediately before B #14.
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
       order by c.created_at desc, c.id desc
       limit v_limit
    ) q;

  return v_result;
end
$$;

revoke all on function public.novelight_comment_feed(text, integer) from public;
grant execute on function public.novelight_comment_feed(text, integer) to anon, authenticated;

drop table if exists public.novel_comment_moderation_events;
drop index if exists public.novel_comments_one_visible_pin_per_novel_idx;

alter table public.novel_comments
  drop constraint if exists novel_comments_author_hidden_reason_valid,
  drop constraint if exists novel_comments_author_reply_body_valid,
  drop constraint if exists novel_comments_author_reply_timestamps_valid,
  drop column if exists author_hidden_at,
  drop column if exists author_hidden_reason,
  drop column if exists pinned_at,
  drop column if exists author_reply_body,
  drop column if exists author_reply_at,
  drop column if exists author_reply_updated_at;

commit;
