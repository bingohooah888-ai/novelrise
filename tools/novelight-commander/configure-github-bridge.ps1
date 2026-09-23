param(
  [Parameter(Mandatory = $true)]
  [int]$IssueNumber,
  [string]$PollSeconds = '10'
)

$ErrorActionPreference = 'Stop'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $Here '..\..')).Path
$BridgeRoot = Join-Path $env:LOCALAPPDATA 'NOVELIGHT\commander-bridge'
$DataRoot = Join-Path $env:USERPROFILE 'Documents\NOVELIGHT-Bridge'
$ConfigPath = Join-Path $BridgeRoot 'config.json'
$TokenPath = Join-Path $BridgeRoot 'github-token.dpapi'
$LogPath = Join-Path $BridgeRoot 'bridge.log'

New-Item -ItemType Directory -Force -Path $BridgeRoot | Out-Null
New-Item -ItemType Directory -Force -Path $DataRoot | Out-Null

Write-Host ''
Write-Host 'Create a fine-grained GitHub token for ONLY bingohooah888-ai/novelrise with:'
Write-Host '  Metadata: Read'
Write-Host '  Issues: Read and write'
Write-Host 'Paste it into the secure prompt below. Do NOT paste it into ChatGPT.'
Write-Host ''

$SecureToken = Read-Host 'GitHub fine-grained token' -AsSecureString
$EncryptedToken = $SecureToken | ConvertFrom-SecureString
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($TokenPath, $EncryptedToken, $Utf8NoBom)

$Config = [ordered]@{
  owner = 'bingohooah888-ai'
  repository = 'novelrise'
  issueNumber = $IssueNumber
  repoRoot = $RepoRoot
  dataRoot = $DataRoot
  pollSeconds = [int]$PollSeconds
  statePath = (Join-Path $BridgeRoot 'state.json')
  auditPath = (Join-Path $BridgeRoot 'audit.jsonl')
}
$ConfigJson = $Config | ConvertTo-Json
[System.IO.File]::WriteAllText($ConfigPath, $ConfigJson, $Utf8NoBom)

Write-Host 'Validating token and control issue...'
$Bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureToken)
try {
  $PlainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Bstr)
  $Headers = @{
    Authorization = "Bearer $PlainToken"
    Accept = 'application/vnd.github+json'
    'X-GitHub-Api-Version' = '2022-11-28'
    'User-Agent' = 'NOVELIGHT-Commander-Bridge-Setup'
  }
  $Issue = Invoke-RestMethod `
    -Uri "https://api.github.com/repos/bingohooah888-ai/novelrise/issues/$IssueNumber" `
    -Headers $Headers
  if ($Issue.title -ne '[NOVELIGHT Commander] Local Bridge') {
    throw 'Control issue title mismatch.'
  }
  if ($Issue.user.login -ne 'bingohooah888-ai') {
    throw 'Control issue owner mismatch.'
  }
  if (-not ([string]$Issue.body).StartsWith('NOVELIGHT_COMMANDER_CONTROL_V1')) {
    throw 'Control issue marker mismatch.'
  }
} finally {
  if ($Bstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Bstr)
  }
  Remove-Variable PlainToken -ErrorAction SilentlyContinue
}

$StartupDir = [Environment]::GetFolderPath('Startup')
$LegacyStartupFile = Join-Path $StartupDir 'NOVELIGHT-Commander-Bridge.cmd'
$StartupFile = Join-Path $StartupDir 'NOVELIGHT-Commander-Bridge.vbs'
$RunnerScript = Join-Path $Here 'run-github-bridge.ps1'
$BridgeCommand = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + $RunnerScript + '" -ConfigPath "' + $ConfigPath + '"'
$EscapedBridgeCommand = $BridgeCommand.Replace('"', '""')
$StartupBody = 'CreateObject("WScript.Shell").Run "' + $EscapedBridgeCommand + '", 0, False'
Set-Content -Path $StartupFile -Value $StartupBody -Encoding ascii
Remove-Item -Path $LegacyStartupFile -Force -ErrorAction SilentlyContinue

$Existing = Get-CimInstance Win32_Process |
  Where-Object {
    $_.CommandLine -match 'github-bridge-daemon\.js' -and
    $_.CommandLine -like '*NOVELIGHT*'
  }

if (-not $Existing) {
  Start-Process `
    -FilePath 'powershell.exe' `
    -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', "`"$RunnerScript`"", '-ConfigPath', "`"$ConfigPath`"" `
    -WindowStyle Hidden
}

Write-Host ''
Write-Host 'NOVELIGHT Commander GitHub bridge is configured.'
Write-Host "Control issue: #$IssueNumber"
Write-Host "Data root: $DataRoot"
Write-Host "Local log: $LogPath"
Write-Host "Startup launcher: $StartupFile"
Write-Host ''
Start-Sleep -Seconds 2
if (Test-Path $LogPath) {
  $BridgeTail = Get-Content -Path $LogPath -Tail 20 -ErrorAction SilentlyContinue
  if ($BridgeTail -match 'NOVELIGHT Commander bridge failed') {
    throw "Commander bridge failed to start. See $LogPath"
  }
}
Write-Host 'The GitHub token is stored only as a Windows DPAPI-encrypted user secret.'
