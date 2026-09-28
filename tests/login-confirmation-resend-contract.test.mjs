import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [login, confirmationTemplateRaw, workflow, ledgerRaw] = await Promise.all(
  [
    readFile('login.html', 'utf8'),
    readFile('config/auth-confirmation-email-ja.json', 'utf8'),
    readFile(
      '.github/workflows/production-auth-confirmation-email-ja.yml',
      'utf8'
    ),
    readFile('production-approval-ledger.json', 'utf8')
  ]
);
const confirmationTemplate = JSON.parse(confirmationTemplateRaw);
const ledger = JSON.parse(ledgerRaw);

test('login exposes a Japanese confirmation-email resend recovery flow', () => {
  assert.match(login, /確認メールが届かない方/u);
  assert.match(login, /id="resendConfirmationButton"/u);
  assert.match(login, /確認メールを再送/u);
  assert.match(
    login,
    /supabaseClient\.auth\.resend\(\{type:'signup',email,options:\{emailRedirectTo\}\}\)/u
  );
  assert.match(login, /login\.html\?confirmed=1/u);
  assert.match(login, /迷惑メール・プロモーション・すべてのメール/u);
});

test('login routes unconfirmed-email errors to the resend recovery flow', () => {
  assert.match(login, /email_not_confirmed/u);
  assert.match(login, /メールアドレスの確認が完了していません/u);
  assert.match(login, /focusConfirmationHelp\(\)/u);
});

test('confirmation resend is rate-limited client-side and reports failures in Japanese', () => {
  assert.match(login, /RESEND_COOLDOWN_MS=60000/u);
  assert.match(login, /sessionStorage\.setItem\(RESEND_COOLDOWN_KEY/u);
  assert.match(login, /短時間に複数回の送信が行われました/u);
  assert.match(login, /確認メールを再送できませんでした/u);
  assert.doesNotMatch(login, /service_role|SUPABASE_SECRET_KEY|auth\.admin/u);
});

test('confirmation email source is Japanese and keeps the Supabase confirmation URL', () => {
  assert.equal(
    confirmationTemplate.subject,
    '【NOVELIGHT】メールアドレスの確認'
  );
  assert.match(confirmationTemplate.html, /NOVELIGHTへようこそ/u);
  assert.match(confirmationTemplate.html, /メールアドレスを確認する/u);
  assert.match(confirmationTemplate.html, /\{\{ \.ConfirmationURL \}\}/u);
  assert.match(confirmationTemplate.html, /心当たりがない場合/u);
});

test('Production route is ledgered and limits the Supabase Auth patch to confirmation template fields', () => {
  assert.ok(
    ledger.activeSharedRoutes.includes(
      '.github/workflows/production-auth-confirmation-email-ja.yml'
    )
  );
  assert.match(
    workflow,
    /NOVELIGHT_PRODUCTION_AUTH_CONFIRMATION_EMAIL_JA_REQUEST/u
  );
  assert.match(
    workflow,
    /NOVELIGHT_PRODUCTION_AUTH_CONFIRMATION_EMAIL_JA_APPROVE/u
  );
  assert.match(workflow, /mailer_subjects_confirmation/u);
  assert.match(workflow, /mailer_templates_confirmation_content/u);
  assert.match(
    workflow,
    /jq -e 'keys \| sort == \["mailer_subjects_confirmation","mailer_templates_confirmation_content"\]'/u
  );
  assert.doesNotMatch(
    workflow,
    /keys \| sort == \[\\"mailer_subjects_confirmation/u
  );
  assert.match(
    workflow,
    /del\(\.mailer_subjects_confirmation,\.mailer_templates_confirmation_content\)/u
  );
  assert.match(
    workflow,
    /diff -u \/tmp\/auth-before-preserved\.json \/tmp\/auth-after-preserved\.json/u
  );
});
