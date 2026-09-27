begin;

revoke all on function public.light_seed_status_auto_v1(text) from public, anon, authenticated;
revoke all on function public.plant_light_seed_auto_v1(text) from public, anon, authenticated;

drop function if exists public.plant_light_seed_auto_v1(text);
drop function if exists public.light_seed_status_auto_v1(text);

-- Restore the pre-cutover beta-v2 client contract only when this migration is
-- explicitly rolled back.
revoke all on function public.light_seed_status_v2(text) from public, anon, authenticated;
grant execute on function public.light_seed_status_v2(text) to anon, authenticated;

revoke all on function public.plant_light_seed_v2(text, text) from public, anon, authenticated;
grant execute on function public.plant_light_seed_v2(text, text) to authenticated;

commit;
