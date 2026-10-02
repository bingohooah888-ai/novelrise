-- Beta tuning based on observed valid-read drop-off.
-- Keep server-timed foreground presence authoritative while requiring deeper
-- reading progress for both scrolling and TTS-assisted reading.

update public.valid_read_rules
set normal_progress_ratio = 0.80,
    short_progress_ratio = 0.80,
    normal_foreground_seconds = 30,
    rule_version = 'beta-v2',
    updated_at = now()
where id = 1;
