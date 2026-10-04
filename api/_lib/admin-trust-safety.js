import { isSameOriginRequest, parseAdminAllowlist } from "./admin-dashboard.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REVIEW_DECISIONS = new Set(["clear", "watch", "hold", "confirmed_abuse"]);
const SIGNAL_ACTIONS = new Set(["dismiss", "confirm", "reactivate"]);

function getBearerToken(value) {
  const match =
    typeof value === "string" ? value.match(/^Bearer\s+(\S+)$/i) : null;
  return match?.[1] ?? null;
}

function isAllowedAdmin(user, allowlist) {
  const id = typeof user?.id === "string" ? user.id.toLowerCase() : "";
  const email =
    typeof user?.email === "string" ? user.email.trim().toLowerCase() : "";
  return allowlist.userIds.has(id) || (email && allowlist.emails.has(email));
}

function numberInRange(value, fallback, min, max) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

function cleanNote(value) {
  const note = String(value ?? "").trim();
  return note.length <= 2000 ? note : null;
}

function cleanUuid(value) {
  const id = String(value ?? "").trim();
  return UUID_PATTERN.test(id) ? id : null;
}

function fail(res, status, error) {
  return res.status(status).json({ ok: false, error });
}

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
}

async function authAdmin(req, res, supabase, env) {
  const token = getBearerToken(req.headers?.authorization);
  if (!token) return { response: fail(res, 401, "authentication_required") };

  let allowlist;
  try {
    allowlist = parseAdminAllowlist(env);
  } catch (error) {
    console.error("[trust-safety] admin allowlist error", error);
    return { response: fail(res, 503, "admin_configuration_error") };
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return { response: fail(res, 401, "invalid_session") };
  }
  if (!isAllowedAdmin(data.user, allowlist)) {
    return { response: fail(res, 403, "forbidden") };
  }
  return { user: data.user };
}

async function loadEmails(supabase, ids) {
  const wanted = new Set(ids.filter(Boolean));
  const emails = new Map();
  if (!wanted.size || !supabase.auth?.admin?.listUsers) return emails;

  for (let page = 1; page <= 20 && wanted.size; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) {
      throw new Error(`Trust & Safety auth user list failed: ${error.message}`);
    }
    const users = data?.users ?? [];
    for (const user of users) {
      if (!wanted.has(user.id)) continue;
      emails.set(user.id, user.email ?? null);
      wanted.delete(user.id);
    }
    if (users.length < 1000) break;
  }
  return emails;
}

function collectUserIds(profiles, signals, links, reviews) {
  const ids = new Set();
  for (const row of profiles ?? []) ids.add(row.user_id);
  for (const row of signals ?? []) ids.add(row.user_id);
  for (const row of links ?? []) {
    ids.add(row.user_id_a);
    ids.add(row.user_id_b);
  }
  for (const row of reviews ?? []) {
    ids.add(row.user_id);
    ids.add(row.reviewer_user_id);
  }
  return [...ids].filter(Boolean);
}

export function summarizeTrustDashboard({
  profiles = [],
  signals = [],
  links = [],
  reviews = [],
  emails = new Map(),
}) {
  const high = profiles.filter((row) =>
    ["high", "critical"].includes(row.risk_level),
  ).length;
  const critical = profiles.filter(
    (row) => row.risk_level === "critical",
  ).length;
  const holds = profiles.filter((row) => row.payout_hold).length;
  const activeSignals = signals.filter((row) =>
    ["active", "confirmed"].includes(row.status),
  ).length;
  const activeLinks = links.filter((row) =>
    ["active", "confirmed"].includes(row.status),
  ).length;

  const users = profiles.map((row) => ({
    ...row,
    email: emails.get(row.user_id) ?? null,
    signals: signals.filter((signal) => signal.user_id === row.user_id),
    links: links.filter(
      (link) =>
        link.user_id_a === row.user_id || link.user_id_b === row.user_id,
    ),
    recentReviews: reviews
      .filter((review) => review.user_id === row.user_id)
      .slice(0, 10),
  }));

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      highOrCritical: high,
      critical,
      payoutHolds: holds,
      activeSignals,
      activeLinks,
    },
    users,
  };
}

export async function loadTrustDashboard({
  supabase,
  minScore = 0,
  limit = 100,
}) {
  const profileQuery = supabase
    .from("trust_risk_profiles")
    .select("*")
    .gte("risk_score", minScore)
    .order("risk_score", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(limit);
  const { data: profiles, error: profileError } = await profileQuery;
  if (profileError) {
    throw new Error(`Trust profiles query failed: ${profileError.message}`);
  }

  const profileIds = (profiles ?? []).map((row) => row.user_id);
  if (!profileIds.length) return summarizeTrustDashboard({ profiles: [] });

  const [signalResult, linkResult, reviewResult] = await Promise.all([
    supabase
      .from("trust_risk_signals")
      .select("*")
      .in("user_id", profileIds)
      .order("observed_at", { ascending: false })
      .limit(500),
    supabase
      .from("trust_account_links")
      .select("*")
      .or(
        `user_id_a.in.(${profileIds.join(",")}),user_id_b.in.(${profileIds.join(",")})`,
      )
      .order("last_seen_at", { ascending: false })
      .limit(500),
    supabase
      .from("trust_reviews")
      .select("*")
      .in("user_id", profileIds)
      .order("created_at", { ascending: false })
      .limit(300),
  ]);

  if (signalResult.error) {
    throw new Error(
      `Trust signals query failed: ${signalResult.error.message}`,
    );
  }
  if (linkResult.error) {
    throw new Error(`Trust links query failed: ${linkResult.error.message}`);
  }
  if (reviewResult.error) {
    throw new Error(
      `Trust reviews query failed: ${reviewResult.error.message}`,
    );
  }

  const emails = await loadEmails(
    supabase,
    collectUserIds(
      profiles ?? [],
      signalResult.data ?? [],
      linkResult.data ?? [],
      reviewResult.data ?? [],
    ),
  );

  return summarizeTrustDashboard({
    profiles: profiles ?? [],
    signals: signalResult.data ?? [],
    links: linkResult.data ?? [],
    reviews: reviewResult.data ?? [],
    emails,
  });
}

export function createAdminTrustSafetyHandler({
  supabase,
  env = process.env,
  loadDashboard = loadTrustDashboard,
} = {}) {
  if (!supabase) throw new Error("supabase is required");

  return async function adminTrustSafety(req, res) {
    setNoStore(res);
    if (!["GET", "POST"].includes(req.method)) {
      return fail(res, 405, "method_not_allowed");
    }
    if (!isSameOriginRequest(req)) {
      return fail(res, 403, "cross_site_request_blocked");
    }

    const auth = await authAdmin(req, res, supabase, env);
    if (!auth.user) return auth.response;

    try {
      if (req.method === "GET") {
        const minScore = numberInRange(req.query?.minScore, 0, 0, 100);
        const limit = numberInRange(req.query?.limit, 100, 1, 200);
        if (minScore === null || limit === null) {
          return fail(res, 400, "invalid_query");
        }
        const dashboard = await loadDashboard({ supabase, minScore, limit });
        return res.status(200).json({ ok: true, ...dashboard });
      }

      const body = req.body ?? {};
      const action = String(body.action ?? "");
      if (action === "scan_user") {
        const userId = cleanUuid(body.userId);
        const windowDays = numberInRange(body.windowDays, 60, 1, 180);
        if (!userId || windowDays === null) {
          return fail(res, 400, "invalid_scan_request");
        }
        const { data, error } = await supabase.rpc(
          "novelight_trust_scan_user",
          {
            p_user_id: userId,
            p_window_days: windowDays,
          },
        );
        if (error) throw new Error(
            `Trust scan failed: ${error.message}`,
        );
        return res.status(200).json({ ok: true, result: data });
      }

      if (action === "review") {
        const userId = cleanUuid(body.userId);
        const decision = String(body.decision ?? "");
        const note = cleanNote(body.note);
        if (!userId || !REVIEW_DECISIONS.has(decision) || note === null) {
          return fail(res, 400, "invalid_review_request");
        }
        const { data, error } = await supabase.rpc(
          "novelight_admin_trust_review",
          {
            p_reviewer_user_id: auth.user.id,
            p_user_id: userId,
            p_decision: decision,
            p_note: note || null,
          },
        );
        if (error) throw new Error(
            `Trust review failed: ${error.message}`,
        );
        return res.status(200).json({ ok: true, profile: data });
      }

      if (action === "signal_action") {
        const signalId = cleanUuid(body.signalId);
        const signalAction = String(body.signalAction ?? "");
        const note = cleanNote(body.note);
        if (!signalId || !SIGNAL_ACTIONS.has(signalAction) || note === null) {
          return fail(res, 400, "invalid_signal_action");
        }
        const { data, error } = await supabase.rpc(
          "novelight_admin_trust_signal_action",
          {
            p_reviewer_user_id: auth.user.id,
            p_signal_id: signalId,
            p_action: signalAction,
            p_note: note || null,
          },
        );
        if (error) {
          throw new Error(
            `Trust signal action failed: ${error.message}`,
          );
        }
        return res.status(200).json({ ok: true, result: data });
      }

      return fail(res, 400, "unknown_action");
    } catch (error) {
      console.error("[trust-safety] request failed", error);
      return fail(res, 500, "trust_safety_request_failed");
    }
  };
}
