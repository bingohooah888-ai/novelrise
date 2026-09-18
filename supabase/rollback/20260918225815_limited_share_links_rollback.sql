\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260918225815:rollback'));

do $$
begin
  if to_regclass('public.novel_share_links') is not null
     and exists (select 1 from public.novel_share_links limit 1) then
    raise exception 'ROLLBACK REFUSED: active limited-share links exist';
  end if;
end
$$;

drop trigger if exists novelight_revoke_share_link_when_public on public.novels;

revoke all on function public._novelight_revoke_share_link_when_public()
  from public, anon, authenticated, service_role;
drop function if exists public._novelight_revoke_share_link_when_public();

revoke all on function public.novelight_shared_episode(text, bigint)
  from public, anon, authenticated, service_role;
drop function if exists public.novelight_shared_episode(text, bigint);

revoke all on function public.novelight_shared_novel(text)
  from public, anon, authenticated, service_role;
drop function if exists public.novelight_shared_novel(text);

revoke all on function public.novelight_revoke_share_link(bigint)
  from public, anon, authenticated, service_role;
drop function if exists public.novelight_revoke_share_link(bigint);

revoke all on function public.novelight_rotate_share_link(bigint)
  from public, anon, authenticated, service_role;
drop function if exists public.novelight_rotate_share_link(bigint);

revoke all on function public.novelight_share_link_status(bigint)
  from public, anon, authenticated, service_role;
drop function if exists public.novelight_share_link_status(bigint);

drop table if exists public.novel_share_links;

commit;
