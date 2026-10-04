import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const base = readFileSync(
  new URL(
    "../supabase/migrations/20261004193000_trust_safety_v1.sql",
    import.meta.url,
  ),
  "utf8",
);
const behavior = readFileSync(
  new URL(
    "../supabase/migrations/20261004193500_trust_safety_v1_behavior_and_audit.sql",
    import.meta.url,
  ),
  "utf8",
);
const composite = readFileSync(
  new URL(
    "../supabase/migrations/20261004193600_trust_safety_v1_composite_scan.sql",
    import.meta.url,
  ),
  "utf8",
);

const all = `${base}\n${behavior}\n${composite}`;

test("Trust & Safety tables are admin-only and RLS protected", () => {
  for (const table of [
    "trust_risk_signals",
    "trust_risk_profiles",
    "trust_account_links",
    "trust_reviews",
  ]) {
    assert.match(
      all,
      new RegExp(
        `alter table public\\.${table} enable row level security`,
        "i",
      ),
    );
    assert.match(
      all,
      new RegExp(
        `revoke all on public\\.${table} from anon, authenticated`,
        "i",
      ),
    );
  }
});

test("Trust & Safety scanner does not persist raw network or visitor identifiers in evidence JSON", () => {
  assert.doesNotMatch(all, /jsonb_build_object\s*\(\s*['"]ip['"]/i);
  assert.doesNotMatch(all, /jsonb_build_object\s*\(\s*['"]user_agent['"]/i);
  assert.doesNotMatch(
    all,
    /jsonb_build_object\s*\(\s*['"]viewer_key_hash['"]/i,
  );
  assert.match(all, /Raw IP addresses are deliberately not copied/i);
  assert.match(all, /Never copy it to evidence/i);
});

test("Trust & Safety thresholds hold payouts without implementing automatic bans", () => {
  assert.match(base, /v_score >= 60/i);
  assert.match(base, /when .*>= 80 then 'critical'/i);
  assert.match(base, /when .*>= 60 then 'high'/i);
  assert.match(base, /when .*>= 30 then 'medium'/i);
  assert.doesNotMatch(all, /delete\s+from\s+auth\.users/i);
  assert.doesNotMatch(all, /ban_duration/i);
});

test("shared IP alone stays a weak signal while stronger combinations carry more weight", () => {
  assert.match(base, /'shared_network', v_weight, 35/i);
  assert.match(
    base,
    /when v_shared_network >= 4 then 15 when v_shared_network >= 2 then 10 else 5/i,
  );
  assert.match(base, /'shared_viewer_key', v_weight, 85/i);
  assert.match(base, /'rapid_registration_cluster', 25, 80/i);
});

test("bot behavior scan is part of the same admin scan entry point", () => {
  assert.match(behavior, /robotic_valid_read_burst/i);
  assert.match(behavior, /robotic_valid_read_timing/i);
  assert.match(behavior, /max_valid_reads_in_5m/i);
  assert.match(composite, /novelight_trust_scan_identity/i);
  assert.match(composite, /novelight_trust_scan_behavior/i);
  assert.match(
    composite,
    /create or replace function public\.novelight_trust_scan_user/i,
  );
});

test("only service role can execute Trust & Safety mutation functions", () => {
  for (const fn of [
    "novelight_trust_scan_user",
    "novelight_trust_scan_behavior",
    "novelight_admin_trust_review",
    "novelight_admin_trust_signal_action",
  ]) {
    assert.match(
      all,
      new RegExp(`grant execute on function public\\.${fn}`, "i"),
    );
    assert.match(all, new RegExp(`to service_role`, "i"));
  }
});
