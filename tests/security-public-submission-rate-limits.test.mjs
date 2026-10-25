import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const migration = readFileSync(
  new URL(
    '../supabase/migrations/20261025042000_atomic_contact_report_rate_limits.sql',
    import.meta.url
  ),
  'utf8'
);

function definition(name) {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(start >= 0, `${name} definition must exist`);
  const end = migration.indexOf('$function$;', start);
  assert.ok(end > start, `${name} definition must be complete`);
  return migration.slice(start, end);
}

test('contact form rate limiting serializes both email and visitor identity', () => {
  const body = definition('submit_contact_inquiry');
  const emailLock = body.indexOf("'novelight:contact:email:'");
  const visitorLock = body.indexOf("'novelight:contact:visitor:'");
  const count = body.indexOf('from public.contact_inquiries');
  const insert = body.indexOf('insert into public.contact_inquiries');
  assert.ok(emailLock >= 0);
  assert.ok(visitorLock > emailLock);
  assert.ok(count > visitorLock);
  assert.ok(insert > count);
  assert.match(body, /pg_catalog\.pg_advisory_xact_lock/g);
  assert.match(body, /v_recent_count >= 3/i);
  assert.match(body, /interval '10 minutes'/i);
  assert.match(body, /v_email !~ /i);
});

test('content reports serialize each authenticated user and visitor token', () => {
  const body = definition('submit_content_report');
  const userLock = body.indexOf("'novelight:report:user:'");
  const visitorLock = body.indexOf("'novelight:report:visitor:'");
  const count = body.indexOf('from public.content_reports');
  const insert = body.indexOf('insert into public.content_reports');
  assert.match(body, /if v_uid is not null then[\s\S]*pg_catalog\.pg_advisory_xact_lock/i);
  assert.ok(userLock >= 0);
  assert.ok(visitorLock > userLock);
  assert.ok(count > visitorLock);
  assert.ok(insert > count);
  assert.match(body, /v_recent >= 5/i);
  assert.match(body, /interval '1 hour'/i);
});

test('hardening does not remove public submission behavior or alter grants', () => {
  assert.match(migration, /p_website text DEFAULT ''::text/);
  assert.match(migration, /auth\.uid\(\)/);
  assert.doesNotMatch(migration, /\brevoke\s+(?:all|execute)/i);
  assert.doesNotMatch(migration, /\bdrop\s+function/i);
  assert.doesNotMatch(migration, /\bdelete\s+from/i);
  assert.match(migration, /^begin;[\s\S]*commit;\s*$/i);
});
