import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [
  account,
  shell,
  shellCss,
  mypage,
  authReturn,
  authorPublic,
  searchPublic,
  rankingPublic,
  scoutRecord,
  adminBetaAuthors,
  qualificationMigration,
  preopenMigration
] = await Promise.all([
  readFile('account-settings.html', 'utf8'),
  readFile('novelight-author-studio-shell.js', 'utf8'),
  readFile('novelight-author-studio-shell.css', 'utf8'),
  readFile('mypage.html', 'utf8'),
  readFile('auth-reader-context.js', 'utf8'),
  readFile('author.html', 'utf8'),
  readFile('search.html', 'utf8'),
  readFile('ranking.html', 'utf8'),
  readFile('scout-record.html', 'utf8'),
  readFile('admin-beta-authors.html', 'utf8'),
  readFile(
    'supabase/migrations/20260920122000_founding_beta_qualifications.sql',
    'utf8'
  ),
  readFile(
    'supabase/migrations/20260919151044_beta_author_preopen_access.sql',
    'utf8'
  )
]);

test('account settings verifies the logged-in user before rendering private email', () => {
  assert.match(account, /client\.auth\.getUser\(\)/u);
  assert.match(
    account,
    /location\.replace\('login\.html\?redirect=account-settings\.html'\)/u
  );
  assert.match(account, /currentEmailEl\.textContent=currentEmail/u);
  assert.doesNotMatch(account, /client\.auth\.getSession\(\)/u);
  assert.doesNotMatch(account, /NovelightClient/u);
  assert.doesNotMatch(account, /localStorage|sessionStorage/u);
  assert.doesNotMatch(account, /console\.(?:log|error|warn)/u);
});

test('account settings changes email only through the official logged-in Auth API', () => {
  assert.match(
    account,
    /client\.auth\.updateUser\(\{email:newEmail\}\)/u
  );
  assert.doesNotMatch(account, /auth\.admin/u);
  assert.doesNotMatch(account, /auth\.users/u);
  assert.doesNotMatch(account, /SUPABASE_SECRET_KEY|service_role/u);
  assert.doesNotMatch(account, /\.from\(|\.rpc\(/u);
  assert.doesNotMatch(account, /profiles\.email|email_normalized/u);
});

test('account settings separates validation, request and confirmation-pending states', () => {
  assert.match(account, /type="email"/u);
  assert.match(account, /現在と同じメールアドレス/u);
  assert.match(account, /新しいメールアドレスが一致していません/u);
  assert.match(account, /確認メールを送信しました/u);
  assert.match(account, /変更の確認待ち/u);
  assert.match(account, /リンクが期限切れの場合/u);
  assert.match(account, /確認が完了するまでは現在のメールアドレスが有効/u);
  assert.match(account, /user\.new_email\|\|user\.email_change_sent_at/u);
});

test('Author Studio and mypage expose matching interaction and account settings navigation', () => {
  assert.match(shell, /\['interaction-settings\.html', '⚙', '交流設定'\]/u);
  assert.match(shell, /\['account-settings\.html', '⌘', 'アカウント設定'\]/u);
  assert.match(shell, /accountChip\.href = 'account-settings\.html'/u);
  assert.match(
    mypage,
    /href="interaction-settings\.html"[\s\S]*?>交流設定</u
  );
  assert.match(
    mypage,
    /href="account-settings\.html"[\s\S]*?>アカウント設定</u
  );
  assert.match(shellCss, /workspace-top > \.reader-home-link/u);
  assert.match(shellCss, /\.account-chip:hover/u);
  assert.match(authReturn, /'\/account-settings\.html'/u);
  assert.match(authReturn, /'\/interaction-settings\.html'/u);
});

test('public reader and author surfaces do not gain a public account-email source', () => {
  for (const source of [
    authorPublic,
    searchPublic,
    rankingPublic,
    scoutRecord
  ]) {
    assert.doesNotMatch(source, /profiles\.email/u);
    assert.doesNotMatch(source, /auth\.users\.email/u);
    assert.doesNotMatch(source, /auth\.admin\.listUsers/u);
  }
});

test('preregistration email remains historical admin data rather than current login email', () => {
  assert.match(adminBetaAuthors, />先行登録メール</u);
  assert.match(adminBetaAuthors, /先行登録メール（履歴）/u);
  assert.doesNotMatch(
    adminBetaAuthors,
    /現在のログインメール|現在のメールアドレス/u
  );
});

test('Founding and beta qualification remain anchored to auth_user_id after registration', () => {
  assert.match(
    qualificationMigration,
    /p\.auth_user_id = p_user_id[\s\S]*?p\.email_normalized = v_email/u
  );
  assert.match(
    qualificationMigration,
    /auth_user_id = p_user_id/u
  );
  assert.match(
    qualificationMigration,
    /insert into public\.founding_authors[\s\S]*?p_user_id/u
  );
  assert.match(
    qualificationMigration,
    /insert into public\.beta_participants[\s\S]*?p_user_id/u
  );
});

test('AUTHOR_PREOPEN continues to gate initial signup on preregistration email only', () => {
  assert.match(preopenMigration, /AUTHOR_PREOPEN/u);
  assert.match(
    preopenMigration,
    /p\.email_normalized = v_email/u
  );
  assert.match(preopenMigration, /p\.status <> 'cancelled'/u);
  assert.doesNotMatch(account, /beta_author_preregistrations/u);
});
