-- Roll back Chapter 38 star-rating SCOUT EXP without deleting raw rating history.
-- Current ratings and scout_event_ledger remain intact for later replay.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260909190000:rollback'));

delete from public.scout_xp_ledger x
where x.xp_kind = 'star_rating'
  and x.rule_version = 'beta-v1';

create or replace function public.set_novel_star_rating(
  p_novel_id text,
  p_rating integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_author_id uuid;
  v_old_rating smallint;
  v_had_old boolean := false;
  v_event_id uuid := pg_catalog.gen_random_uuid();
  v_event_type text;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if p_rating is null or p_rating not between 1 and 5 then
    raise exception using errcode = '22023', message = '評価は1から5で指定してください';
  end if;

  select n.user_id
    into v_author_id
    from public.novels n
   where n.id::text = p_novel_id
     and n.status = 'published';

  if not found then
    raise exception using errcode = '23514', message = '公開作品が見つかりません';
  end if;

  if v_author_id = v_uid then
    raise exception using errcode = '42501', message = '自分の作品は評価できません';
  end if;

  select r.rating
    into v_old_rating
    from public.novel_star_ratings r
   where r.user_id = v_uid
     and r.novel_id_snapshot = p_novel_id;
  v_had_old := found;

  if v_had_old and v_old_rating = p_rating::smallint then
    return public.novelight_star_rating_status(p_novel_id);
  end if;

  if v_had_old then
    update public.novel_star_ratings
       set rating = p_rating::smallint,
           author_id_snapshot = v_author_id,
           updated_at = pg_catalog.now()
     where user_id = v_uid
       and novel_id_snapshot = p_novel_id;
    v_event_type := 'star_rating_changed';
  else
    insert into public.novel_star_ratings (
      user_id,
      novel_id_snapshot,
      author_id_snapshot,
      rating
    ) values (
      v_uid,
      p_novel_id,
      v_author_id,
      p_rating::smallint
    );
    v_event_type := 'star_rating_set';
  end if;

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
    v_event_type,
    v_event_type || ':' || v_event_id::text,
    p_novel_id,
    pg_catalog.now(),
    pg_catalog.jsonb_build_object(
      'old_rating', case when v_had_old then v_old_rating else null end,
      'new_rating', p_rating::smallint
    )
  );

  return public.novelight_star_rating_status(p_novel_id);
end
$$;

revoke all on function public.set_novel_star_rating(text, integer) from public, anon;
grant execute on function public.set_novel_star_rating(text, integer) to authenticated;

commit;
