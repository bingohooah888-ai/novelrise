\set ON_ERROR_STOP on

select
  to_regclass('public.announcements') is not null as announcements_exists,
  (select count(*) from public.announcements) as announcement_count,
  (select count(*) from public.announcements where status = 'published') as published_count;
