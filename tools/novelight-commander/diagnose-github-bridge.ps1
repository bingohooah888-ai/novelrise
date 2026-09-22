param()

$ErrorActionPreference = 'Stop'

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$BridgeRoot = Join-Path $env:LOCALAPPDATA 'NOVELIGHT\commander-bridge'
$ConfigPath = Join-Path $BridgeRoot 'config.json'
$TokenPath = Join-Path $BridgeRoot 'github-token.dpapi'
$LogPath = Join-Path $BridgeRoot 'bridge.log'
$RunnerScript = Join-Path $Here 'run-github-bridge.ps1'

if (-not (Test-Path $ConfigPath)) { throw 'Bridge config file is missing.' }
if (-not (Test-Path $TokenPath)) { throw 'Encrypted GitHub token is missing.' }
if (-not (Test-Path $RunnerScript)) { throw 'Bridge runner script is missing.' }

$ConfigText = (Get-Content -Raw -Path $ConfigPath).TrimStart([char]0xFEFF)
$Config = $ConfigText | ConvertFrom-Json

if ($Config.owner -ne 'bingohooah888-ai' -or $Config.repository -ne 'novelrise') {
  throw 'Bridge repository identity mismatch.'
}
if (-not $Config.issueNumber) {
  throw 'Bridge control issue number is missing.'
}

$EncryptedToken = (Get-Content -Raw -Path $TokenPath).Trim().TrimStart([char]0xFEFF)
$SecureToken = $EncryptedToken | ConvertTo-SecureString
$Bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureToken)

try {
  $PlainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Bstr)
  $Headers = @{
    Authorization = "Bearer $PlainToken"
    Accept = 'application/vnd.github+json'
    'X-GitHub-Api-Version' = '2022-11-28'
    'User-Agent' = 'NOVELIGHT-Commander-Bridge-Diagnostic'
  }

  $IssueUri = "https://api.github.com/repos/bingohooah888-ai/novelrise/issues/$($Config.issueNumber)"
  $CommentsUri = "$IssueUri/comments"

  $Issue = Invoke-RestMethod -Uri $IssueUri -Headers $Headers
  if ($Issue.title -ne '[NOVELIGHT Commander] Local Bridge') {
    throw 'Control issue title mismatch.'
  }
  if ($Issue.user.login -ne 'bingohooah888-ai') {
    throw 'Control issue owner mismatch.'
  }

  $Before = @(Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -match 'github-bridge-daemon\.js'
  })
  $Started = $false

  if ($Before.Count -eq 0) {
    Start-Process `
      -FilePath 'powershell.exe' `
      -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', "`"$RunnerScript`"", '-ConfigPath', "`"$ConfigPath`"" `
      -WindowStyle Hidden
    $Started = $true
    Start-Sleep -Seconds 5
  }

  $After = @(Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -match 'github-bridge-daemon\.js'
  })

  $Tail = @()
  if (Test-Path $LogPath) {
    $Tail = @(Get-Content -Path $LogPath -Tail 30 -ErrorAction SilentlyContinue)
  }

  $SafeTail = @(
    $Tail | ForEach-Object {
      [regex]::Replace(
        [string]$_,
        '(?i)((?:token|secret|password|api[_-]?key)\s*[=:]\s*)\S+',
        '$1[REDACTED]'
      )
    }
  )

  $Lines = @(
    'NOVELIGHT_COMMANDER_DIAGNOSTIC_V1',
    '',
    ('- observed_at: ' + [DateTime]::UtcNow.ToString('o')),
    ('- issue: #' + $Config.issueNumber),
    ('- process_before: ' + $Before.Count),
    ('- restart_attempted: ' + $Started),
    ('- process_after: ' + $After.Count),
    ('- config_path_exists: ' + [bool](Test-Path $ConfigPath)),
    ('- token_path_exists: ' + [bool](Test-Path $TokenPath)),
    ('- log_path_exists: ' + [bool](Test-Path $LogPath)),
    '',
    '~~~text'
  )

  if ($SafeTail.Count -gt 0) {
    $Lines += $SafeTail
  } else {
    $Lines += '[bridge.log is empty]'
  }
  $Lines += '~~~'

  $Body = $Lines -join [Environment]::NewLine
  $Payload = @{ body = $Body } | ConvertTo-Json -Compress

  Invoke-RestMethod `
    -Method Post `
    -Uri $CommentsUri `
    -Headers $Headers `
    -ContentType 'application/json' `
    -Body $Payload | Out-Null

  Write-Host ''
  Write-Host 'NOVELIGHT Commander bridge diagnostic posted to GitHub Issue.'
  Write-Host "Control issue: #$($Config.issueNumber)"
  Write-Host "Bridge process after repair: $($After.Count)"
  Write-Host 'No token was posted.'
} finally {
  Remove-Variable PlainToken -ErrorAction SilentlyContinue
  if ($null -ne $Bstr -and $Bstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Bstr)
  }
}
