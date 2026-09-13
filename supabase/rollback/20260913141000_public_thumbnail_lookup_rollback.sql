-- Data-neutral rollback for NOVELIGHT public official thumbnail lookup.
\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelight:rollback:public-thumbnail-lookup'));

revoke all on function public.novelight_public_thumbnail_urls(text[])
  from public, anon, authenticated;
drop function if exists public.novelight_public_thumbnail_urls(text[]);

commit;
