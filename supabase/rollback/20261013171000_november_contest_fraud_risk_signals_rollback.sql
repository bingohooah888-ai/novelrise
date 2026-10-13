-- Stage 07 signals only: no reader state or score mutation to unwind.
begin;
drop function if exists public.novelight_contest_reader_risk_signals(uuid,uuid);
commit;
