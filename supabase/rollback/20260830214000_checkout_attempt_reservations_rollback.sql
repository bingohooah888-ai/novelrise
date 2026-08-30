-- NOVELIGHT: rollback Checkout attempt reservation boundary.

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260830214000:rollback'));

drop function if exists public.novelight_release_checkout_attempt(uuid, uuid);
drop function if exists public.novelight_attach_checkout_session(uuid, uuid, text);
drop function if exists public.novelight_reserve_checkout_attempt(uuid, text, uuid);
drop table if exists public.billing_checkout_attempts;

commit;
