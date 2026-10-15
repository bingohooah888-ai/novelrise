// Produces a CI-only script for the disposable migration-replay Postgres DB.
// Never uses Supabase credentials, GitHub approvals, or a Production connection.
import { buildAtomicRegistrationOpenSql } from '../scripts/november-contest-registration-open-plan.mjs';

if (process.env.NOVELIGHT_DISPOSABLE_CONTEST_REPLAY !== '1') {
  throw new Error('Disposable contest replay must be explicitly enabled');
}
const releaseSql = buildAtomicRegistrationOpenSql({
  approvalContractValidated: true,
  productionMutationPerformed: false,
  mainSha: 'a'.repeat(40),
  commentId: 123457,
  challenge: 'ABCD1234'
});
const normalClock = 'v_now timestamptz := pg_catalog.clock_timestamp();';
if (releaseSql.split(normalClock).length !== 2) {
  throw new Error('Expected one approval-window clock declaration');
}
// A fixed test-only time makes this disposable replay evergreen after 2026.
const testSql = releaseSql.replace(
  normalClock,
  "v_now timestamptz := '2026-10-15 00:00:00+00'::timestamptz;"
);
// The payload itself is one DO statement. A test-only outer transaction below
// rolls back all changes after asserting both the status and the audit record.
process.stdout.write(
  'begin;\n' +
    testSql +
    `do $assert_release$
declare
  v_contest public.novelight_contests%rowtype;
  v_audits integer;
begin
  select * into strict v_contest
    from public.novelight_contests
   where contest_key = 'novelight-november-2026';
  if v_contest.status <> 'registration'
     or v_contest.public_visible is not true
     or v_contest.terms_version <> 'november-2026-v1'
     or v_contest.terms_url <> 'https://novelight.jp/contest-terms'
  then
    raise exception 'Disposable registration state mismatch';
  end if;
  select count(*)::integer into v_audits
    from public.novelight_contest_review_audit
   where contest_id = v_contest.id
     and action = 'registration_open'
     and evidence_summary->>'approval_comment' = 'github-comment-123457';
  if v_audits <> 1 then
    raise exception 'Atomic release audit row missing or duplicated';
  end if;
end
$assert_release$;
rollback;
select 'PASS: single-statement contest release and audit on disposable PostgreSQL'
  as result;
`
);
