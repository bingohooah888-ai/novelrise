$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Here

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js 20+ is required." }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "Git is required." }

Write-Host "Installing NOVELIGHT Commander dependencies..."
npm install --package-lock=false

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host ""
  Write-Host "Created .env. Set NOVELIGHT_COMMANDER_ROOT to your actual novelrise folder."
}

Write-Host ""
Write-Host "Running checks..."
npm run check
npm test

Write-Host ""
Write-Host "NOVELIGHT Commander v0.5 is ready."
Write-Host "Optional CLIs for full capability: gh, supabase, vercel"
Write-Host "Start with: npm start"
