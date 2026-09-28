begin;

alter table public.novel_thumbnail_compositions
  add column if not exists rendered_at timestamptz;

comment on column public.novel_thumbnail_compositions.rendered_at is
  'Time when the current cached thumbnail render was successfully attached.';

commit;
