\set ON_ERROR_STOP on

-- Simulate the exact pre-beta accident observed in production: an internal
-- test account consumed Founding Author #1 before the exclusion migration.
insert into public.founding_authors (
  author_id,
  founding_number,
  qualifying_novel_id,
  qualified_at
) values (
  '77777777-7777-7777-7777-777777777777',
  1,
  'pre-beta-internal-test-work',
  now()
);
