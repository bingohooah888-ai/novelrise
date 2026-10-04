import assert from "node:assert/strict";
import test from "node:test";

import {
  createAdminTrustSafetyHandler,
  summarizeTrustDashboard,
} from "../api/_lib/admin-trust-safety.js";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const SIGNAL_ID = "33333333-3333-4333-8333-333333333333";

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: new Map(),
    setHeader(name, value) {
      this.headers.set(String(name).toLowerCase(), value);
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function request({ method = "GET", body, query, headers } = {}) {
  return {
    method,
    body,
    query: query ?? {},
    headers: {
      authorization: "Bearer valid-token",
      host: "novelight.example",
      "x-forwarded-proto": "https",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
  };
}

function mockSupabase(user = { id: ADMIN_ID, email: "owner@example.com" }) {
  const rpcCalls = [];
  return {
    rpcCalls,
    auth: {
      async getUser(token) {
        assert.equal(token, "valid-token");
        return { data: { user }, error: null };
      },
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      return { data: { name, args }, error: null };
    },
  };
}

test("trust dashboard summary keeps risk score separate from proof of abuse", () => {
  const profiles = [
    {
      user_id: USER_ID,
      risk_score: 65,
      risk_level: "high",
      payout_hold: true,
      review_state: "unreviewed",
    },
    {
      user_id: ADMIN_ID,
      risk_score: 10,
      risk_level: "low",
      payout_hold: false,
      review_state: "cleared",
    },
  ];
  const signals = [
    {
      id: SIGNAL_ID,
      user_id: USER_ID,
      status: "active",
      signal_type: "shared_viewer_key",
    },
    {
      id: "44444444-4444-4444-8444-444444444444",
      user_id: USER_ID,
      status: "dismissed",
      signal_type: "shared_network",
    },
  ];
  const links = [
    {
      user_id_a: USER_ID,
      user_id_b: ADMIN_ID,
      status: "active",
      link_type: "shared_viewer_key",
    },
  ];
  const reviews = [];
  const emails = new Map([[USER_ID, "reader@example.com"]]);

  const result = summarizeTrustDashboard({
    profiles,
    signals,
    links,
    reviews,
    emails,
  });
  assert.equal(result.summary.highOrCritical, 1);
  assert.equal(result.summary.critical, 0);
  assert.equal(result.summary.payoutHolds, 1);
  assert.equal(result.summary.activeSignals, 1);
  assert.equal(result.summary.activeLinks, 1);
  assert.equal(result.users[0].email, "reader@example.com");
  assert.equal(result.users[0].review_state, "unreviewed");
});

test("trust admin GET requires allowlisted admin and validates filters", async () => {
  const supabase = mockSupabase();
  const loadCalls = [];
  const handler = createAdminTrustSafetyHandler({
    supabase,
    env: { NOVELIGHT_ADMIN_USER_IDS: ADMIN_ID },
    loadDashboard: async (args) => {
      loadCalls.push(args);
      return {
        generatedAt: "2026-10-04T10:30:00Z",
        summary: {},
        users: [],
      };
    },
  });

  const ok = response();
  await handler(request({ query: { minScore: "60", limit: "50" } }), ok);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.ok, true);
  assert.equal(loadCalls[0].minScore, 60);
  assert.equal(loadCalls[0].limit, 50);
  assert.match(String(ok.headers.get("cache-control")), /no-store/);

  const bad = response();
  await handler(request({ query: { minScore: "101" } }), bad);
  assert.equal(bad.statusCode, 400);
  assert.equal(loadCalls.length, 1);
});

test("trust admin refuses non-admin and cross-site requests before data access", async () => {
  let loaded = false;
  const nonAdmin = mockSupabase({ id: USER_ID, email: "reader@example.com" });
  const handler = createAdminTrustSafetyHandler({
    supabase: nonAdmin,
    env: { NOVELIGHT_ADMIN_USER_IDS: ADMIN_ID },
    loadDashboard: async () => {
      loaded = true;
      return {};
    },
  });

  const forbidden = response();
  await handler(request(), forbidden);
  assert.equal(forbidden.statusCode, 403);
  assert.equal(loaded, false);

  const crossSite = response();
  await handler(
    request({ headers: { "sec-fetch-site": "cross-site" } }),
    crossSite,
  );
  assert.equal(crossSite.statusCode, 403);
  assert.equal(loaded, false);
});

test("trust admin only exposes allowlisted scan/review/signal actions", async () => {
  const supabase = mockSupabase();
  const handler = createAdminTrustSafetyHandler({
    supabase,
    env: { NOVELIGHT_ADMIN_USER_IDS: ADMIN_ID },
    loadDashboard: async () => ({}),
  });

  const scan = response();
  await handler(
    request({
      method: "POST",
      body: { action: "scan_user", userId: USER_ID, windowDays: 60 },
    }),
    scan,
  );
  assert.equal(scan.statusCode, 200);
  assert.equal(supabase.rpcCalls[0].name, "novelight_trust_scan_user");
  assert.deepEqual(supabase.rpcCalls[0].args, {
    p_user_id: USER_ID,
    p_window_days: 60,
  });

  const review = response();
  await handler(
    request({
      method: "POST",
      body: {
        action: "review",
        userId: USER_ID,
        decision: "hold",
        note: "複数の証拠を確認",
      },
    }),
    review,
  );
  assert.equal(review.statusCode, 200);
  assert.equal(supabase.rpcCalls[1].name, "novelight_admin_trust_review");
  assert.equal(supabase.rpcCalls[1].args.p_reviewer_user_id, ADMIN_ID);

  const signal = response();
  await handler(
    request({
      method: "POST",
      body: {
        action: "signal_action",
        signalId: SIGNAL_ID,
        signalAction: "dismiss",
      },
    }),
    signal,
  );
  assert.equal(signal.statusCode, 200);
  assert.equal(
    supabase.rpcCalls[2].name,
    "novelight_admin_trust_signal_action",
  );

  const unknown = response();
  await handler(
    request({
      method: "POST",
      body: { action: "execute_sql", sql: "select 1" },
    }),
    unknown,
  );
  assert.equal(unknown.statusCode, 400);
  assert.equal(supabase.rpcCalls.length, 3);
});

test("trust admin rejects malformed ids and oversized notes", async () => {
  const supabase = mockSupabase();
  const handler = createAdminTrustSafetyHandler({
    supabase,
    env: { NOVELIGHT_ADMIN_USER_IDS: ADMIN_ID },
    loadDashboard: async () => ({}),
  });

  const badId = response();
  await handler(
    request({
      method: "POST",
      body: { action: "scan_user", userId: "not-a-uuid" },
    }),
    badId,
  );
  assert.equal(badId.statusCode, 400);

  const longNote = response();
  await handler(
    request({
      method: "POST",
      body: {
        action: "review",
        userId: USER_ID,
        decision: "watch",
        note: "x".repeat(2001),
      },
    }),
    longNote,
  );
  assert.equal(longNote.statusCode, 400);
  assert.equal(supabase.rpcCalls.length, 0);
});
