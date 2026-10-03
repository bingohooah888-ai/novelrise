alter table public.novels
  add column if not exists show_episode_numbers boolean;

update public.novels
set show_episode_numbers = true
where show_episode_numbers is null;

alter table public.novels
  alter column show_episode_numbers set default false,
  alter column show_episode_numbers set not null;

comment on column public.novels.show_episode_numbers is
  'Whether public episode lists and episode pages display automatic 第N話 labels. Existing novels are preserved as true; new novels default to false.';
