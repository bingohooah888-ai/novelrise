alter table public.episodes
  add column if not exists show_episode_number boolean;

update public.episodes
set show_episode_number = true
where show_episode_number is null;

alter table public.episodes
  alter column show_episode_number set default true,
  alter column show_episode_number set not null;

comment on column public.episodes.show_episode_number is
  'Whether this individual episode displays the automatic 第N話 label. Use false for interludes, character guides, setting notes, and other non-numbered entries.';
