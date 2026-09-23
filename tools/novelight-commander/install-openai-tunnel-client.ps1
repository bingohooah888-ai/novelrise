param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "NOVELIGHT\TunnelClient")
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

if (-not [Environment]::Is64BitOperatingSystem) {
  throw "NOVELIGHT Commander currently requires 64-bit Windows for the OpenAI tunnel client."
}

$Headers = @{ "User-Agent" = "NOVELIGHT-Commander-Tunnel-Bootstrap" }
$Release = Invoke-RestMethod -Uri "https://api.github.com/repos/openai/tunnel-client/releases/latest" -Headers $Headers

$Asset = $Release.assets | Where-Object { $_.name -match '^tunnel-client-v.+-windows-amd64[.]zip$' } | Select-Object -First 1
$ChecksumAsset = $Release.assets | Where-Object { $_.name -eq "SHA256SUMS.txt" } | Select-Object -First 1

if (-not $Asset) {
  throw "The latest OpenAI tunnel-client release does not contain the full Windows amd64 ZIP."
}
if (-not $ChecksumAsset) {
  throw "The latest OpenAI tunnel-client release does not contain SHA256SUMS.txt."
}

$TempRoot = Join-Path $env:TEMP "NOVELIGHT\TunnelClientBootstrap"
New-Item -ItemType Directory -Force -Path $TempRoot | Out-Null

$ZipPath = Join-Path $TempRoot $Asset.name
$ChecksumPath = Join-Path $TempRoot $ChecksumAsset.name

Invoke-WebRequest -Uri $Asset.browser_download_url -Headers $Headers -OutFile $ZipPath
Invoke-WebRequest -Uri $ChecksumAsset.browser_download_url -Headers $Headers -OutFile $ChecksumPath

$ChecksumLine = Get-Content $ChecksumPath | Where-Object { $_ -match [regex]::Escape($Asset.name) } | Select-Object -First 1

if (-not $ChecksumLine) {
  throw "No published SHA-256 entry was found for $($Asset.name)."
}

$ExpectedSha = (($ChecksumLine -split '\s+')[0]).Trim().ToLowerInvariant()
$ActualSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $ZipPath).Hash.ToLowerInvariant()

if ($ExpectedSha -ne $ActualSha) {
  throw "OpenAI tunnel-client SHA-256 verification failed."
}

if (Test-Path $InstallDir) {
  Remove-Item $InstallDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Expand-Archive -LiteralPath $ZipPath -DestinationPath $InstallDir -Force
Get-ChildItem $InstallDir -Recurse -File | Unblock-File -ErrorAction SilentlyContinue

$TunnelClient = Get-ChildItem $InstallDir -Recurse -File | Where-Object { $_.Name -eq "tunnel-client.exe" } | Select-Object -First 1

if (-not $TunnelClient) {
  throw "The verified OpenAI archive did not contain tunnel-client.exe."
}

$ClientDir = $TunnelClient.DirectoryName
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
$PathParts = @($UserPath -split ";" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })

if ($PathParts -notcontains $ClientDir) {
  [Environment]::SetEnvironmentVariable("Path", ((@($ClientDir) + $PathParts) -join ";"), "User")
}

$env:Path = "$ClientDir;$env:Path"

Write-Host "OpenAI tunnel-client installed and verified."
Write-Host "Version: $($Release.tag_name)"
Write-Host "Path: $($TunnelClient.FullName)"
