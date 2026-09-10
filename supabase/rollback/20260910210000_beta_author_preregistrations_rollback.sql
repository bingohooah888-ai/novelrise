begin;

revoke execute on function public.record_beta_author_preregistration_event(text, text, text) from anon, authenticated;
revoke execute on function public.submit_beta_author_preregistration(text, text, text, text, text, text, boolean, text, text, text) from anon, authenticated;

drop function if exists public.record_beta_author_preregistration_event(text, text, text);
drop function if exists public.submit_beta_author_preregistration(text, text, text, text, text, text, boolean, text, text, text);

drop table if exists public.beta_author_preregistration_events;
drop table if exists public.beta_author_preregistrations;

commit;