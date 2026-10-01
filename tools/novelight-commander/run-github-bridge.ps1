param(
  [Parameter(Mandatory = $true)]
  [string]$ConfigPath
)

$ErrorActionPreference = 'Stop'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$BridgeRoot = Split-Path -Parent $ConfigPath
$TokenPath = Join-Path $BridgeRoot 'github-token.dpapi'
$LogPath = Join-Path $BridgeRoot 'bridge.log'
$DaemonPath = Join-Path $Here 'src\github-bridge-daemon.js'
$NodePath = (Get-Command node -ErrorAction Stop).Source

if (-not (Test-Path $ConfigPath)) { throw 'Bridge config file is missing.' }
if (-not (Test-Path $TokenPath)) { throw 'Encrypted GitHub token is missing.' }
if (-not (Test-Path $DaemonPath)) { throw 'Bridge daemon is missing.' }

function Read-EncryptedBridgeToken {
  $EncryptedToken = (Get-Content -Raw -Path $TokenPath).Trim().TrimStart([char]0xFEFF)
  if (-not $EncryptedToken) { throw 'Encrypted GitHub token is empty.' }
  $SecureToken = $EncryptedToken | ConvertTo-SecureString
  $Bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureToken)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Bstr)
  } finally {
    if ($Bstr -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Bstr)
    }
  }
}

function Test-BridgeToken([string]$Token, [int]$IssueNumber) {
  if (-not $Token) { return $false }
  try {
    $Headers = @{
      Authorization = "Bearer $Token"
      Accept = 'application/vnd.github+json'
      'X-GitHub-Api-Version' = '2022-11-28'
      'User-Agent' = 'NOVELIGHT-Commander-Bridge-Supervisor'
    }
    $Issue = Invoke-RestMethod `
      -Uri "https://api.github.com/repos/bingohooah888-ai/novelrise/issues/$IssueNumber" `
      -Headers $Headers `
      -TimeoutSec 15
    return (
      $Issue.title -eq '[NOVELIGHT Commander] Local Bridge' -and
      $Issue.user.login -eq 'bingohooah888-ai' -and
      ([string]$Issue.body).StartsWith('NOVELIGHT_COMMANDER_CONTROL_V1')
    )
  } catch {
    $Status = $null
    try { $Status = [int]$_.Exception.Response.StatusCode } catch {}
    if ($Status -in @(401, 403)) { return $false }
    throw
  }
}

function Save-BridgeToken([string]$Token) {
  $SecureToken = ConvertTo-SecureString $Token -AsPlainText -Force
  $EncryptedToken = $SecureToken | ConvertFrom-SecureString
  $Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($TokenPath, $EncryptedToken, $Utf8NoBom)
}

function Recover-BridgeTokenFromGh([int]$IssueNumber) {
  $Gh = Get-Command gh -ErrorAction SilentlyContinue
  if (-not $Gh) { throw 'Stored GitHub token is invalid and gh CLI is unavailable for safe recovery.' }

  $Owner = (& $Gh.Source api user --jq .login 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $Owner -ne 'bingohooah888-ai') {
    throw 'Stored GitHub token is invalid and local gh authentication is not the repository owner.'
  }

  $Title = (& $Gh.Source api "repos/bingohooah888-ai/novelrise/issues/$IssueNumber" --jq .title 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $Title -ne '[NOVELIGHT Commander] Local Bridge') {
    throw 'Local gh authentication cannot access the NLO control issue.'
  }

  $Token = (& $Gh.Source auth token 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $Token) {
    throw 'Local gh authentication did not return a usable token.'
  }
  if (-not (Test-BridgeToken -Token $Token -IssueNumber $IssueNumber)) {
    throw 'Recovered gh token failed NLO control issue validation.'
  }

  Save-BridgeToken -Token $Token
  Add-Content -Path $LogPath -Value "$(Get-Date -Format o) NOVELIGHT Commander bridge recovered GitHub authentication from verified local gh owner session."
  return $Token
}

function Resolve-BridgeToken([int]$IssueNumber) {
  $Stored = Read-EncryptedBridgeToken
  if (Test-BridgeToken -Token $Stored -IssueNumber $IssueNumber) {
    return $Stored
  }
  return Recover-BridgeTokenFromGh -IssueNumber $IssueNumber
}

$Config = Get-Content -Raw -Path $ConfigPath | ConvertFrom-Json
if ([int]$Config.issueNumber -lt 1) { throw 'Bridge config issueNumber is invalid.' }
$IssueNumber = [int]$Config.issueNumber

try {
  $env:NOVELIGHT_BRIDGE_CONFIG = $ConfigPath

  $RestartDelaySeconds = 2
  $MaxRestartDelaySeconds = 60

  while ($true) {
    $StartedAt = Get-Date
    $PreviousErrorActionPreference = $ErrorActionPreference
    try {
      $env:NOVELIGHT_BRIDGE_GITHUB_TOKEN = Resolve-BridgeToken -IssueNumber $IssueNumber

      # Windows PowerShell 5 surfaces native stderr as NativeCommandError records.
      # Node deprecation warnings must not terminate the NLO supervisor; the native
      # process exit code remains the authority for restart decisions below.
      $ErrorActionPreference = 'Continue'
      & $NodePath $DaemonPath *>> $LogPath
      $ExitCode = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $PreviousErrorActionPreference
      Remove-Item Env:NOVELIGHT_BRIDGE_GITHUB_TOKEN -ErrorAction SilentlyContinue
    }
    $Stamp = Get-Date -Format o

    if ($ExitCode -eq 75) {
      Add-Content -Path $LogPath -Value "$Stamp NOVELIGHT Commander bridge requested a planned restart; restarting in 2 seconds."
      $RestartDelaySeconds = 2
      Start-Sleep -Seconds 2
      continue
    }

    if ($ExitCode -eq 0) {
      Add-Content -Path $LogPath -Value "$Stamp NOVELIGHT Commander bridge exited normally; supervisor stopping."
      break
    }

    $RuntimeSeconds = ((Get-Date) - $StartedAt).TotalSeconds
    if ($RuntimeSeconds -ge 60) {
      $RestartDelaySeconds = 2
    }

    Add-Content -Path $LogPath -Value "$Stamp NOVELIGHT Commander bridge exited with code $ExitCode; restarting in $RestartDelaySeconds seconds."
    Start-Sleep -Seconds $RestartDelaySeconds
    $RestartDelaySeconds = [Math]::Min($MaxRestartDelaySeconds, [Math]::Max(2, $RestartDelaySeconds * 2))
  }
} catch {
  $Stamp = Get-Date -Format o
  Add-Content -Path $LogPath -Value "$Stamp NOVELIGHT Commander bridge failed: $($_.Exception.Message)"
  throw
} finally {
  Remove-Item Env:NOVELIGHT_BRIDGE_GITHUB_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:NOVELIGHT_BRIDGE_CONFIG -ErrorAction SilentlyContinue
}
