import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const helperSource = await readFile('auth-reader-context.js', 'utf8');
const login = await readFile('login.html', 'utf8');
const signup = await readFile('signup.html', 'utf8');
const index = await readFile('index.html', 'utf8');

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

function loadHelper(href, storage = createStorage()) {
  const url = new URL(href);
  let replacedTarget = null;
  const window = {
    location: {
      origin: url.origin,
      search: url.search,
      hash: url.hash,
      replace(target) {
        replacedTarget = target;
      }
    },
    localStorage: storage
  };

  vm.runInNewContext(helperSource, {
    window,
    URL,
    URLSearchParams,
    Date,
    JSON,
    Number,
    Object,
    console
  });

  return {
    api: window.NovelightAuthReturn,
    storage,
    replacedTarget: () => replacedTarget
  };
}

test('auth reader context accepts only same-origin allowlisted targets', () => {
  const { api } = loadHelper('https://novelight.jp/login.html');

  assert.equal(
    api.safeRedirectTarget('novel.html?id=novel-1'),
    'novel.html?id=novel-1'
  );
  assert.equal(
    api.safeRedirectTarget('/episode.html?id=episode-2&novelId=novel-1'),
    'episode.html?id=episode-2&novelId=novel-1'
  );
  assert.equal(
    api.safeRedirectTarget('https://evil.example/novel.html?id=x'),
    'mypage.html'
  );
  assert.equal(
    api.safeRedirectTarget('//evil.example/episode.html?id=x'),
    'mypage.html'
  );
  assert.equal(
    api.safeRedirectTarget('/login.html?redirect=novel.html'),
    'mypage.html'
  );
});

test('login and signup keep the sanitized redirect across the auth choice', () => {
  const { api } = loadHelper(
    'https://novelight.jp/login.html?redirect=novel.html%3Fid%3Dnovel-1'
  );

  assert.equal(api.currentRedirect(), 'novel.html?id=novel-1');
  assert.equal(
    api.authHref('signup.html', api.currentRedirect()),
    'signup.html?redirect=novel.html%3Fid%3Dnovel-1'
  );

  assert.match(login, /id="signupLink" href="signup\.html"/);
  assert.match(login, /src="auth-reader-context\.js"/);
  assert.match(
    login,
    /NovelightAuthReturn\.authHref\('signup\.html',redirect\)/
  );
  assert.match(signup, /id="loginLink" href="login\.html"/);
  assert.match(signup, /src="auth-reader-context\.js"/);
  assert.match(
    signup,
    /NovelightAuthReturn\.authHref\('login\.html',redirect\)/
  );
});

test('signup keeps the known-good confirmation URL and stores context only after success', () => {
  assert.match(
    signup,
    /emailRedirectTo:window\.location\.origin\+'\/index\.html'/
  );

  const signupIndex = signup.indexOf('client.auth.signUp');
  const rememberIndex = signup.indexOf(
    'NovelightAuthReturn.rememberPendingTarget(redirect)'
  );
  assert.ok(signupIndex >= 0);
  assert.ok(rememberIndex > signupIndex);
  assert.match(index, /src="auth-reader-context\.js"/);
  assert.match(
    index,
    /NovelightAuthReturn\.resumePendingSignupContext\(client\)/
  );
});

test('confirmed signup resumes a pending safe reader target once a session exists', async () => {
  const storage = createStorage();
  const signupContext = loadHelper(
    'https://novelight.jp/signup.html?redirect=episode.html%3Fid%3Dep-2%26novelId%3Dnovel-1',
    storage
  );
  signupContext.api.rememberPendingTarget(signupContext.api.currentRedirect());

  const confirmed = loadHelper(
    'https://novelight.jp/index.html#access_token=test&type=signup',
    storage
  );
  const resumed = await confirmed.api.resumePendingSignupContext({
    auth: {
      async getSession() {
        return { data: { session: { user: { id: 'reader-1' } } }, error: null };
      }
    }
  });

  assert.equal(resumed, true);
  assert.equal(
    confirmed.replacedTarget(),
    'episode.html?id=ep-2&novelId=novel-1'
  );

  const secondAttempt = loadHelper(
    'https://novelight.jp/index.html#access_token=test&type=signup',
    storage
  );
  assert.equal(
    await secondAttempt.api.resumePendingSignupContext({
      auth: {
        async getSession() {
          return { data: { session: {} }, error: null };
        }
      }
    }),
    false
  );
});

test('confirmation does not consume reader context before a session exists', async () => {
  const storage = createStorage();
  const signupContext = loadHelper(
    'https://novelight.jp/signup.html?redirect=novel.html%3Fid%3Dnovel-9',
    storage
  );
  signupContext.api.rememberPendingTarget(signupContext.api.currentRedirect());

  const firstReturn = loadHelper(
    'https://novelight.jp/index.html#type=signup',
    storage
  );
  assert.equal(
    await firstReturn.api.resumePendingSignupContext({
      auth: {
        async getSession() {
          return { data: { session: null }, error: null };
        }
      }
    }),
    false
  );
  assert.equal(firstReturn.replacedTarget(), null);

  const laterReturn = loadHelper(
    'https://novelight.jp/index.html#access_token=test&type=signup',
    storage
  );
  assert.equal(
    await laterReturn.api.resumePendingSignupContext({
      auth: {
        async getSession() {
          return { data: { session: {} }, error: null };
        }
      }
    }),
    true
  );
  assert.equal(laterReturn.replacedTarget(), 'novel.html?id=novel-9');
});
