# NOVELIGHT SCOUT LV10 approved-artwork transfer (no Supabase/Vercel operations)
# Run from a local checkout: powershell -ExecutionPolicy Bypass -File tools/novelight-commander/install-scout-campaign-artwork.ps1
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$branch = 'feat/scout-lv10-campaign-hero-20261008'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$downloads = Join-Path $env:USERPROFILE 'Downloads'
$archive = Get-ChildItem -LiteralPath $downloads -File |
  Where-Object { $_.Name -match '^NOVELIGHT_SCOUT_campaign_PC_MOBILE(?:\(\d+\))?\.zip$' } |
  Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
if (-not $archive) { throw 'The approved NOVELIGHT_SCOUT_campaign_PC_MOBILE ZIP is not in Downloads.' }
$gitRoot = (& git -C $repo rev-parse --show-toplevel 2>&1)
if ($LASTEXITCODE -ne 0) { throw "NOVELIGHT git repository is unavailable: $gitRoot" }
$gitRoot = [string]$gitRoot
& git -C $gitRoot fetch --no-tags origin $branch
if ($LASTEXITCODE -ne 0) { throw 'Could not fetch approved feature branch.' }
$head = (& git -C $gitRoot rev-parse "origin/$branch").Trim()
$workspace = Join-Path $env:TEMP ('novelight-scout-art-' + [guid]::NewGuid().ToString('N'))
$extract = Join-Path $env:TEMP ('novelight-scout-zip-' + [guid]::NewGuid().ToString('N'))
$worktreeAdded = $false
try {
  Expand-Archive -LiteralPath $archive.FullName -DestinationPath $extract
  $items = @(
    @{ Name = 'NOVELIGHT_SCOUT_PC_1888x913.png'; Width = 1888; Height = 913 },
    @{ Name = 'NOVELIGHT_SCOUT_MOBILE_941x1672.png'; Width = 941; Height = 1672 }
  )
  $sources = @()
  Add-Type -AssemblyName System.Drawing
  foreach ($item in $items) {
    $foundFiles = @(Get-ChildItem -LiteralPath $extract -Recurse -File | Where-Object { $_.Name -eq $item.Name })
    if ($foundFiles.Count -ne 1) { throw "Expected exactly one approved image: $($item.Name)" }
    $img = [System.Drawing.Image]::FromFile($foundFiles[0].FullName)
    try {
      if ($img.Width -ne $item.Width -or $img.Height -ne $item.Height) {
        throw "Approved artwork dimensions mismatch: $($item.Name)"
      }
    } finally { $img.Dispose() }
    $sources += $foundFiles[0]
  }
  & git -C $gitRoot worktree add --detach $workspace $head
  if ($LASTEXITCODE -ne 0) { throw 'Could not create isolated campaign transfer worktree.' }
  $worktreeAdded = $true
  foreach ($source in $sources) {
    Copy-Item -LiteralPath $source.FullName -Destination (Join-Path $workspace ('assets\' + $source.Name))
  }
  foreach ($name in @('scout-lv10-campaign.html', 'novelight-scout-campaign.css', 'tests/scout-lv10-campaign-contract.test.mjs')) {
    $path = Join-Path $workspace $name
    $content = [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8)
    $content = $content.Replace('NOVELIGHT_SCOUT_PC_1888x913.webp', 'NOVELIGHT_SCOUT_PC_1888x913.png')
    $content = $content.Replace('NOVELIGHT_SCOUT_MOBILE_941x1672.webp', 'NOVELIGHT_SCOUT_MOBILE_941x1672.png')
    if ($name -like '*contract.test.mjs') {
      $old = @'
    // The approved compressed exports are simple VP8 WebP files.
    assert.equal(bytes.toString('ascii', 12, 16), 'VP8 ');
    assert.equal(bytes.readUInt16LE(26) & 0x3fff, width, name + ': width');
    assert.equal(bytes.readUInt16LE(28) & 0x3fff, height, name + ': height');
'@
      $new = @'
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(bytes.readUInt32BE(16), width, name + ': width');
    assert.equal(bytes.readUInt32BE(20), height, name + ': height');
'@
      if (-not $content.Contains($old)) { throw 'SCOUT artwork test contract has changed; review required.' }
      $content = $content.Replace($old, $new)
      $content = $content.Replace("    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');`n", '')
      $content = $content.Replace("    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');`n", '')
      $content = $content.Replace("    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');`r`n", '')
      $content = $content.Replace("    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');`r`n", '')
    }
    [IO.File]::WriteAllText($path, $content, [Text.UTF8Encoding]::new($false))
  }
  & git -C $workspace add -- 'assets/NOVELIGHT_SCOUT_PC_1888x913.png' 'assets/NOVELIGHT_SCOUT_MOBILE_941x1672.png' 'scout-lv10-campaign.html' 'novelight-scout-campaign.css' 'tests/scout-lv10-campaign-contract.test.mjs'
  if ($LASTEXITCODE -ne 0) { throw 'Could not stage approved campaign assets.' }
  & git -C $workspace commit -m 'Add approved SCOUT LEVEL 10 PC/mobile campaign artwork'
  if ($LASTEXITCODE -ne 0) { throw 'Could not commit approved campaign assets.' }
  & git -C $workspace push origin "HEAD:refs/heads/$branch"
  if ($LASTEXITCODE -ne 0) { throw 'Could not push campaign assets. No Production change was made.' }
  Write-Output "SCOUT approved images pushed to PR branch: $branch"
  Write-Output "Commit: $((& git -C $workspace rev-parse HEAD).Trim())"
} finally {
  if ($worktreeAdded) { & git -C $gitRoot worktree remove --force $workspace | Out-Null }
  if (Test-Path -LiteralPath $extract) { Remove-Item -LiteralPath $extract -Force -Recurse }
}
