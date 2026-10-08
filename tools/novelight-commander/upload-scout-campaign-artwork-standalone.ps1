# NOVELIGHT SCOUT LEVEL 10 - approved campaign artwork upload
# Uploads only approved PNGs from the user's Downloads ZIP to the existing feature branch.
# Does not change Supabase, Vercel, production, or the local NOVELIGHT checkout.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$branch = 'feat/scout-lv10-campaign-hero-20261008'
$repoUrl = 'https://github.com/bingohooah888-ai/novelrise.git'
$downloads = Join-Path $env:USERPROFILE 'Downloads'
$archive = Get-ChildItem -LiteralPath $downloads -File |
  Where-Object { $_.Name -match '^NOVELIGHT_SCOUT_campaign_PC_MOBILE(?:\(\d+\))?\.zip$' } |
  Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
if (-not $archive) { throw 'Approved NOVELIGHT_SCOUT_campaign_PC_MOBILE ZIP not found in Downloads.' }
$temporary = Join-Path $env:TEMP ('novelight-scout-upload-' + [Guid]::NewGuid().ToString('N'))
$clone = Join-Path $temporary 'repo'
$extract = Join-Path $temporary 'images'
New-Item -Path $temporary -ItemType Directory -Force | Out-Null
try {
  Expand-Archive -LiteralPath $archive.FullName -DestinationPath $extract -Force
  Add-Type -AssemblyName System.Drawing
  $approved = @(
    @{ Name = 'NOVELIGHT_SCOUT_PC_1888x913.png'; Width = 1888; Height = 913 },
    @{ Name = 'NOVELIGHT_SCOUT_MOBILE_941x1672.png'; Width = 941; Height = 1672 }
  )
  $sources = @()
  foreach ($item in $approved) {
    $found = @(Get-ChildItem -LiteralPath $extract -File -Recurse | Where-Object Name -eq $item.Name)
    if ($found.Count -ne 1) { throw "Exactly one approved image required: $($item.Name)" }
    $image = [System.Drawing.Image]::FromFile($found[0].FullName)
    try {
      if ($image.Width -ne $item.Width -or $image.Height -ne $item.Height) {
        throw "Approved image has unexpected dimensions: $($item.Name)"
      }
    } finally { $image.Dispose() }
    $sources += $found[0]
  }
  & git clone --depth 1 --filter=blob:none --single-branch --branch $branch --sparse $repoUrl $clone
  if ($LASTEXITCODE -ne 0) { throw 'GitHub clone failed. Check existing Git credentials.' }
  & git -C $clone sparse-checkout set --no-cone '/scout-lv10-campaign.html' '/novelight-scout-campaign.css' '/tests/scout-lv10-campaign-contract.test.mjs'
  if ($LASTEXITCODE -ne 0) { throw 'Sparse checkout failed.' }
  New-Item -Path (Join-Path $clone 'assets') -ItemType Directory -Force | Out-Null
  foreach ($source in $sources) {
    Copy-Item -LiteralPath $source.FullName -Destination (Join-Path $clone ('assets\' + $source.Name))
  }
  foreach ($name in @('scout-lv10-campaign.html','novelight-scout-campaign.css','tests/scout-lv10-campaign-contract.test.mjs')) {
    $target = Join-Path $clone $name
    $s = [IO.File]::ReadAllText($target, [Text.Encoding]::UTF8)
    $s = $s.Replace('NOVELIGHT_SCOUT_PC_1888x913.webp','NOVELIGHT_SCOUT_PC_1888x913.png')
    $s = $s.Replace('NOVELIGHT_SCOUT_MOBILE_941x1672.webp','NOVELIGHT_SCOUT_MOBILE_941x1672.png')
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
      if (-not $s.Contains($old)) { throw 'Image test changed; refuse unsafe automatic replacement.' }
      $s = $s.Replace($old,$new)
      $s = $s.Replace("    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');`n",'')
      $s = $s.Replace("    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');`n",'')
      $s = $s.Replace("    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');`r`n",'')
      $s = $s.Replace("    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');`r`n",'')
    }
    [IO.File]::WriteAllText($target,$s,[Text.UTF8Encoding]::new($false))
  }
  & git -C $clone add --sparse -- 'assets/NOVELIGHT_SCOUT_PC_1888x913.png' 'assets/NOVELIGHT_SCOUT_MOBILE_941x1672.png' 'scout-lv10-campaign.html' 'novelight-scout-campaign.css' 'tests/scout-lv10-campaign-contract.test.mjs'
  if ($LASTEXITCODE -ne 0) { throw 'Could not stage the two approved images.' }
  & git -C $clone diff --cached --check
  if ($LASTEXITCODE -ne 0) { throw 'Git diff validation failed.' }
  & git -C $clone commit -m 'Register approved SCOUT LEVEL 10 PC and mobile campaign images'
  if ($LASTEXITCODE -ne 0) { throw 'Could not commit approved images.' }
  & git -C $clone push origin "HEAD:refs/heads/$branch"
  if ($LASTEXITCODE -ne 0) { throw 'GitHub push failed; no Production changes made.' }
  Write-Output 'Approved campaign images were pushed to PR #2043.'
  Write-Output "Commit: $((& git -C $clone rev-parse HEAD).Trim())"
} finally {
  if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force }
}
