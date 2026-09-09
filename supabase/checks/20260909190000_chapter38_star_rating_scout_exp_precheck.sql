do $$
begin
  if to_regclass('public.scout_event_ledger') is null
     or to_regclass('public.scout_xp_ledger') is null
     or to_regclass('public.novel_star_ratings') is null then
    raise exception 'Chapter 38 SCOUT and star-rating foundations are required';
  end if;

  if to_regprocedure('public.set_novel_star_rating(text,integer)') is null then
    raise exception 'Chapter 38 star-rating RPC is required';
  end if;

  if position(
    'novelight:star-rating-xp:' in
    pg_get_functiondef('public.set_novel_star_rating(text,integer)'::regprocedure)
  ) > 0 then
    raise exception 'Star-rating SCOUT EXP runtime is already installed';
  end if;

  if exists (
    select 1
      from public.scout_xp_ledger x
     where x.xp_kind = 'star_rating'
  ) then
    raise exception 'Existing star-rating SCOUT EXP requires manual reconciliation';
  end if;
end
$$;
