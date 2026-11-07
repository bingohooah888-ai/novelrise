import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(
  root,
  'tools',
  'novelight-commander',
  'prepare-gateb-isolation.ps1'
);
const source = readFileSync(script, 'utf8');

test(
  'PowerShell AST syntax is valid without invoking the target script',
  {
    skip: process.platform !== 'win32'
  },
  () => {
    const powershell =
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
    // This ONLY parses the script; it does not dot-source, invoke or execute it.
    const expression = `$a=$null;$e=$null;[System.Management.Automation.Language.Parser]::ParseFile(${JSON.stringify(script)},[ref]$a,[ref]$e)|Out-Null;if($e.Count -eq 0){Write-Output "PARSE_OK";exit 0};exit 7`;
    const res = spawnSync(
      powershell,
      ['-NoProfile', '-NonInteractive', '-Command', expression],
      {
        encoding: 'utf8',
        timeout: 10000,
        shell: false,
        env: {
          SystemRoot: 'C:\\Windows',
          WINDIR: 'C:\\Windows',
          PATH: 'C:\\Windows\\System32;C:\\Windows'
        }
      }
    );
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), 'PARSE_OK');
  }
);

test('default is read-only preflight and actual creation demands explicit approval', () => {
  assert.match(source, /\[ValidateSet\('Preflight', 'Apply'\)\]/u);
  assert.match(source, /\[string\]\$Mode = 'Preflight'/u);
  assert.match(source, /\$Mode -eq 'Preflight'/u);
  assert.match(source, /\$OwnerApproval -cne \$ExpectedApproval/u);
  assert.match(source, /GATEB_PREFLIGHT_DENIED_NO_MUTATION/u);
  assert.match(source, /GATEB_APPLY_DENIED_NO_MUTATION/u);
});

test('fixed hostname, exact principal and TWO absent directory paths', () => {
  assert.match(source, /DESKTOP-8Q4GFC8/u);
  assert.match(source, /NOVELIGHT-GateB/u);
  assert.match(source, /C:\\ProgramData\\NOVELIGHT\\GateB/u);
  assert.match(source, /C:\\ProgramData\\NOVELIGHT'/u);
  assert.match(source, /Get-LocalUser -Name \$Account/u);
  assert.match(source, /Test-Path -LiteralPath \$Parent/u);
  assert.match(source, /Test-Path -LiteralPath \$Vault/u);
  assert.match(source, /ReparsePoint/u);
  assert.match(
    source,
    /IsInRole\(\[Security\.Principal\.WindowsBuiltInRole\]::Administrator\)/u
  );
});

test('cryptographic random strong password is not printed or persisted', () => {
  assert.match(source, /RandomNumberGenerator\]::Create\(\)/u);
  assert.match(source, /GetBytes\(\$bytes\)/u);
  assert.match(source, /SecureString\]::new\(\)/u);
  assert.match(source, /AppendChar/u);
  assert.match(source, /MakeReadOnly\(\)/u);
  assert.match(source, /\[Array\]::Clear\(\$bytes/u);
  assert.doesNotMatch(
    source,
    /Write-(Output|Host|Verbose|Information)\s+\$secret|ConvertFrom-SecureString|Read-Host|Get-Clipboard|Set-Clipboard/iu
  );
});

test('creation remains disabled, non-admin and limited to two scoped directories', () => {
  assert.equal(
    (source.match(/New-LocalUser -Name \$Account -Password \$secret/g) || [])
      .length,
    1
  );
  assert.match(
    source,
    /New-LocalUser -Name \$Account -Password \$secret -Disabled/u
  );
  assert.match(source, /Get-LocalGroupMember -SID \$AdminSid\.Value/u);
  assert.equal(
    (source.match(/\[IO\.Directory\]::CreateDirectory\(/g) || []).length,
    2
  );
  assert.match(source, /SetAccessRuleProtection\(\$true, \$false\)/u);
  assert.match(source, /'S-1-5-32-544'/u); // BUILTIN Administrators
  assert.match(source, /'S-1-5-18'/u); // SYSTEM
  assert.match(source, /'ReadAndExecute'/u);
  assert.match(source, /'Modify'/u);
  assert.match(source, /ACL_SYSTEM_ADMIN_NOT_FULL/u);
  assert.match(source, /ACL_MEMBER_EXCESSIVE_OR_INSUFFICIENT/u);
  assert.match(source, /ACL_PARENT_WRITABLE_BY_MEMBER/u);
  assert.match(source, /VAULT_NOT_EMPTY/u);
});

test('rollback never recursively removes unrelated files or modifies existing NLO', () => {
  assert.match(source, /\[IO\.Directory\]::Delete\(\$Vault, \$false\)/u);
  assert.match(source, /\[IO\.Directory\]::Delete\(\$Parent, \$false\)/u);
  assert.match(source, /Remove-LocalUser -SID \$createdSid/u);
  assert.match(source, /ACCOUNT_IDENTITY_CHANGED/u);
  assert.match(source, /GATEB_PARTIAL_STATE_MANUAL_RECONCILIATION_REQUIRED/u);
  assert.doesNotMatch(
    source,
    /Remove-Item|Remove-LocalGroup|Enable-LocalUser|Set-LocalUser|Register-ScheduledTask|New-ScheduledTask|Start-Service|Invoke-WebRequest|Invoke-RestMethod|github\.com|api\.supabase\.com|vercel\.com|cloudflare\.com/iu
  );
});

test(
  'offline test has not created real account or directories',
  {
    skip: process.platform !== 'win32'
  },
  () => {
    const powershell =
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
    const inspect = [
      '$ErrorActionPreference="Stop";',
      '$u=Get-LocalUser -Name "NOVELIGHT-GateB" -ErrorAction SilentlyContinue;',
      '$a=Test-Path -LiteralPath "C:\\ProgramData\\NOVELIGHT";',
      '$b=Test-Path -LiteralPath "C:\\ProgramData\\NOVELIGHT\\GateB";',
      'if($u -or $a -or $b){exit 8};',
      'Write-Output "TARGETS_UNCHANGED"'
    ].join('');
    const result = spawnSync(
      powershell,
      ['-NoProfile', '-NonInteractive', '-Command', inspect],
      { encoding: 'utf8', timeout: 10000, shell: false }
    );
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), 'TARGETS_UNCHANGED');
  }
);
