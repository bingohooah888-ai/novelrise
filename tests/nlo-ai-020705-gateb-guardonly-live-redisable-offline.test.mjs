import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const ps = readFileSync(
  join(
    here,
    '..',
    'tools',
    'novelight-commander',
    'gateb-guardonly-live-redisable-one-shot.ps1'
  ),
  'utf8'
);

test('pins host, target, existing SYSTEM task and installed Worker SHA', () => {
  for (const key of [
    'DESKTOP-8Q4GFC8',
    'NOVELIGHT-GateB',
    'NOVELIGHT-GateB-Independent-Recovery',
    '78242cd888dcb3bedb0a899daf5549e21461a1b65d6a604188acdecccf78f15c'
  ]) {
    assert.ok(ps.includes(key), key);
  }
  assert.match(ps, /GUARD_ONLY/);
});
test('defaults to read-only preflight; Apply requires a distinct explicit token', () => {
  assert.match(ps, /\[string\]\$Mode='Preflight'/);
  assert.match(ps, /if \(\$Mode -eq 'Preflight'\)/);
  assert.match(ps, /\$OwnerApproval -cne \$Approval/);
  assert.match(ps, /GATEB_GUARDONLY_LIVE_APPLY_NOT_APPROVED/);
});
test('preserves old ledger and blocks re-execution with atomic CreateNew marker', () => {
  assert.match(ps, /parentgone-once-consumed\.marker/);
  assert.match(ps, /guardonly-live-redisable-once-consumed\.marker/);
  assert.match(ps, /FileMode\]::CreateNew/);
  assert.match(ps, /ROOT_FILES_UNEXPECTED_OR_ALREADY_CONSUMED/);
  assert.doesNotMatch(ps, /Remove-Item|File\]::Delete/);
});
test('actually enables only the fixed account and observes the SYSTEM disable evidence', () => {
  assert.match(ps, /Enable-LocalUser -Name \$Account/);
  assert.match(ps, /DISABLED_BY_WATCHDOG/);
  assert.match(ps, /accountWasEnabledBefore/);
  assert.match(ps, /disableAttempted/);
  assert.match(ps, /observedDisabled/);
  assert.match(ps, /sequence -gt/);
  assert.match(ps, /AddSeconds\(105\)/);
});
test('has only one conditional emergency disable, checks residue and NLO definitions', () => {
  assert.equal((ps.match(/Disable-LocalUser -Name/g) ?? []).length, 1);
  assert.match(ps, /if \(\$u.Enabled\)/);
  assert.match(ps, /Win32_Process/);
  assert.match(ps, /Win32_UserProfile/);
  assert.match(ps, /Export-ScheduledTask/);
  assert.match(ps, /NO_GO_ACCOUNT_UNCONFIRMED/);
});
test('does not modify tasks, passwords, state, unrelated accounts or cloud resources', () => {
  assert.doesNotMatch(
    ps,
    /\b(?:Start-ScheduledTask|Register-ScheduledTask|Set-ScheduledTask|Stop-Process|Set-LocalUser|Remove-LocalUser|Set-Content|Invoke-RestMethod|Invoke-WebRequest)\b/
  );
  assert.doesNotMatch(
    ps,
    /ConvertTo-SecureString|Reset-Password|Set-LocalGroupMember/
  );
  assert.doesNotMatch(ps, /\b(?:stripe|supabase|vercel|cloudflare)\b/i);
});
