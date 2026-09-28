import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const signupHtml = readFileSync(
  new URL('../signup.html', import.meta.url),
  'utf8',
);
const helperStart = signupHtml.indexOf('function isMailRateLimitError(error)');
const helperEnd = signupHtml.indexOf(
  '\nfunction isNetworkFetchError',
  helperStart,
);

assert.notEqual(
  helperStart,
  -1,
  'isMailRateLimitError must exist in signup.html',
);
assert.notEqual(
  helperEnd,
  -1,
  'isMailRateLimitError must end before isNetworkFetchError',
);

const helperSource = signupHtml.slice(helperStart, helperEnd);
const isMailRateLimitError = Function(
  `${helperSource}; return isMailRateLimitError;`,
)();

test('detects Supabase Auth email rate limit responses', () => {
  assert.equal(
    isMailRateLimitError({
      status: 429,
      code: 'over_email_send_rate_limit',
      message: 'email rate limit exceeded',
    }),
    true,
  );
});

test('detects upstream daily email quota wording', () => {
  assert.equal(
    isMailRateLimitError({
      status: 500,
      message: 'You have reached your daily email sending quota.',
    }),
    true,
  );
});

test('does not classify unrelated auth errors as mail rate limits', () => {
  assert.equal(
    isMailRateLimitError({
      status: 422,
      code: 'weak_password',
      message: 'Password is known to be weak and easy to guess.',
    }),
    false,
  );
});

test('signup page reports mail congestion without blaming the invite', () => {
  assert.match(
    signupHtml,
    /確認メールの送信が混み合っています。入力内容や招待URLの問題ではありません。/,
  );
  assert.doesNotMatch(
    signupHtml,
    /signupCampaignState==='AUTHOR_PREOPEN'\?'先行登録メールの専用招待URLと、先行登録時のメールアドレスを確認してください。'/,
  );
});
