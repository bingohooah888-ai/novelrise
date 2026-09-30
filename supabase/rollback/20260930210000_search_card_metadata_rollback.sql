-- Roll back the frontend together with this RPC. No stored data is changed.
begin;
drop function if exists public.novelight_search_card_metadata(bigint[]);
commit;
