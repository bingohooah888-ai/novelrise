import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTEST_GUEST_COOKIE,
  issueContestGuestCredential,
  verifyContestGuestCredential,
  readContestGuestCookie,
  contestGuestOriginAllowed,
  pseudonymizeGuestNetwork,
  advanceContestGuestRead,
  contestReaderPoints,
  contestGuestPayoutDisposition
} from '../api/_lib/contest-guest-security.js';

const secret = 'november-contest-test-secret-32-bytes-only';
const contestKey = 'november-2026-novelight';
const now = Date.UTC(2026, 10, 5);

test('signed guest cookie cannot be spoofed, replayed to another contest, or used after expiry', () => {
  const { token, cookie, guestHash } = issueContestGuestCredential({
    secret, contestKey, now, nonce: 'a'.repeat(48)
  });
  assert.match(cookie, new RegExp('^' + CONTEST_GUEST_COOKIE + '='));
  assert.match(cookie, /HttpOnly; Secure; SameSite=Lax/);
  assert.equal(
    verifyContestGuestCredential({ token, secret, contestKey, now: now + 60000 }).guestHash,
    guestHash
  );
  assert.equal(verifyContestGuestCredential({
    token: token.replace(/.$/, '0'), secret, contestKey, now
  }), null);
  assert.equal(verifyContestGuestCredential({
    token, secret, contestKey: 'different-contest', now
  }), null);
  assert.equal(verifyContestGuestCredential({
    token, secret, contestKey, now: now + 41 * 86400000
  }), null);
  assert.equal(verifyContestGuestCredential({
    token, secret, contestKey, now: now - 100
  }), null);
});

test('duplicate cookies are treated as suspicious, not silently accepted', () => {
  const token = issueContestGuestCredential({ secret, contestKey, now }).token;
  assert.equal(readContestGuestCookie(CONTEST_GUEST_COOKIE + '=' + token), token);
  assert.equal(readContestGuestCookie(
    CONTEST_GUEST_COOKIE + '=' + token + '; ' + CONTEST_GUEST_COOKIE + '=' + token
  ), null);
  assert.equal(readContestGuestCookie('other=abc'), null);
});

test('cross-origin and cross-site posts fail closed', () => {
  const allowed = ['https://novelight.jp'];
  assert.equal(contestGuestOriginAllowed({
    origin: 'https://novelight.jp', 'sec-fetch-site': 'same-origin'
  }, allowed), true);
  assert.equal(contestGuestOriginAllowed({
    origin: 'https://evil.example', 'sec-fetch-site': 'cross-site'
  }, allowed), false);
  assert.equal(contestGuestOriginAllowed({ origin: '' }, allowed), false);
  assert.equal(contestGuestOriginAllowed({
    origin: 'https://novelight.jp.evil.example'
  }, allowed), false);
  assert.equal(contestGuestOriginAllowed({
    origin: 'https://novelight.jp', 'sec-fetch-site': 'same-site'
  }, allowed), false);
  assert.equal(contestGuestOriginAllowed({
    origin: 'https://novelight.jp'
  }, []), false);
});

test('network/agent evidence is keyed and never contains raw addresses', () => {
  const one = pseudonymizeGuestNetwork({
    secret, contestKey, ip: '203.0.113.22', userAgent: 'Reader One'
  });
  const sameCohort = pseudonymizeGuestNetwork({
    secret, contestKey, ip: '203.0.113.23', userAgent: 'Reader Two'
  });
  assert.equal(one.networkHash, sameCohort.networkHash);
  assert.notEqual(one.agentHash, sameCohort.agentHash);
  assert.equal(JSON.stringify(one).includes('203.0.113'), false);
  assert.equal(pseudonymizeGuestNetwork({
    secret, contestKey, ip: 'invalid', userAgent: ''
  }).networkHash, null);
});

test('strict guest credit requires trusted server elapsed time AND reading progress', () => {
  const previous = {
    startedAt: 1000, lastSeenAt: 1000, lastSeq: 0,
    foregroundMs: 0, maxProgress: 0, qualified: false
  };
  const rule = {
    maxSequenceJump: 3, maxHeartbeatCreditMs: 12000,
    minForegroundMs: 30000, minProgress: 0.8
  };
  const first = advanceContestGuestRead({
    previous, payload: { seq: 1, visible: true, progress: 1 },
    serverNow: 2000, rule
  });
  assert.equal(first.accepted, true);
  assert.equal(first.qualified, false); // Scroll to bottom is not proof.
  const gap = advanceContestGuestRead({
    previous: first.next, payload: { seq: 2, visible: true, progress: 1 },
    serverNow: 80000, rule
  });
  assert.equal(gap.qualified, false); // One long background gap cannot earn time.
  assert.equal(gap.next.foregroundMs, 13000);
  const hidden = advanceContestGuestRead({
    previous: gap.next, payload: { seq: 3, visible: false, progress: 1 },
    serverNow: 90000, rule
  });
  assert.equal(hidden.next.foregroundMs, 13000);
  const done = advanceContestGuestRead({
    previous: { ...hidden.next, foregroundMs: 29999 },
    payload: { seq: 4, visible: true, progress: 1 },
    serverNow: 90001, rule
  });
  assert.equal(done.qualified, true);
  assert.equal(done.newlyQualified, true);
});

test('replayed and malformed heartbeats do not advance reading credit', () => {
  const previous = {
    startedAt: 0, lastSeenAt: 10000, lastSeq: 2,
    foregroundMs: 0, maxProgress: 0.5, qualified: false
  };
  const rule = {
    maxSequenceJump: 3, maxHeartbeatCreditMs: 12000,
    minForegroundMs: 30000, minProgress: 0.8
  };
  for (const payload of [
    { seq: 2, visible: true, progress: 0.9 },
    { seq: 9, visible: true, progress: 0.9 },
    { seq: 3, visible: true, progress: 2 },
    { seq: 3, visible: 'true', progress: 0.9 }
  ]) {
    assert.equal(advanceContestGuestRead({
      previous, payload, serverNow: 20000, rule
    }).accepted, false);
  }
  assert.equal(advanceContestGuestRead({
    previous, payload: { seq: 3, visible: true, progress: 0.9 },
    serverNow: 9999, rule
  }).accepted, false);
});

test('3/5/10 threshold points REPLACE, never accumulate', () => {
  for (const [episodes, expected] of [
    [0, 0], [2, 0], [3, 1], [4, 1], [5, 3],
    [9, 3], [10, 5], [100, 5]
  ]) {
    assert.equal(contestReaderPoints(episodes), expected);
  }
  assert.throws(() => contestReaderPoints(-1));
  assert.throws(() => contestReaderPoints(2.5));
});

test('guest awards remain provisional and suspicious identity requires manual review', () => {
  const base = {
    verifiedSession: true, readEvidenceValid: true,
    suspectedAutomation: false, suspectedSybil: false,
    overlapWithAuthenticatedUser: false, confirmedAbuse: false
  };
  assert.equal(contestGuestPayoutDisposition(base), 'provisional');
  assert.equal(contestGuestPayoutDisposition({
    ...base, suspectedSybil: true
  }), 'review_hold');
  assert.equal(contestGuestPayoutDisposition({
    ...base, overlapWithAuthenticatedUser: true
  }), 'review_hold');
  assert.equal(contestGuestPayoutDisposition({
    ...base, confirmedAbuse: true
  }), 'exclude');
  assert.equal(contestGuestPayoutDisposition({
    ...base, verifiedSession: false
  }), 'not_qualified');
});
