# ============================================================
# WeiboAgent Setup Script
# ============================================================
# Run this script in PowerShell (Admin is NOT required)
# Usage: .\setup.ps1
# ============================================================

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$locoRoot = Join-Path $projectRoot "agent"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  WeiboAgent Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# --- Step 1: Check/Install Bun ---
Write-Host "[1/5] Checking Bun runtime..." -ForegroundColor Yellow
$bunPath = $null
try { $bunPath = (Get-Command bun -ErrorAction SilentlyContinue).Source } catch {}

if (-not $bunPath) {
    $bunHome = "$env:USERPROFILE\.bun\bin\bun.exe"
    if (Test-Path $bunHome) {
        $env:Path = "$env:USERPROFILE\.bun\bin;$env:Path"
        $bunPath = $bunHome
    }
}

if ($bunPath) {
    Write-Host "  ✓ Bun found: $bunPath" -ForegroundColor Green
    & bun --version
} else {
    Write-Host "  ⚠ Bun not found. Install manually:" -ForegroundColor Red
    Write-Host "    powershell -c `"irm bun.sh/install.ps1 | iex`"" -ForegroundColor White
    Write-Host "    Then re-run this script." -ForegroundColor White
    exit 1
}

# --- Step 2: Check Python ---
Write-Host "[2/5] Checking Python..." -ForegroundColor Yellow
try {
    $pyVer = python --version 2>&1
    Write-Host "  ✓ $pyVer" -ForegroundColor Green
} catch {
    try {
        $pyVer = python3 --version 2>&1
        Write-Host "  ✓ $pyVer" -ForegroundColor Green
    } catch {
        Write-Host "  ⚠ Python 3.9+ required. Install from https://www.python.org/downloads/" -ForegroundColor Red
        Write-Host "    Or: winget install Python.Python.3.12" -ForegroundColor White
        exit 1
    }
}

# --- Step 3: Check Node.js ---
Write-Host "[3/5] Checking Node.js..." -ForegroundColor Yellow
try {
    $nodeVer = node --version 2>&1
    Write-Host "  ✓ Node $nodeVer" -ForegroundColor Green
} catch {
    Write-Host "  ⚠ Node.js 16+ required. Install from https://nodejs.org/" -ForegroundColor Red
    Write-Host "    Or: winget install OpenJS.NodeJS.LTS" -ForegroundColor White
    exit 1
}

# --- Step 4: Install agent dependencies ---
Write-Host "[4/5] Installing agent dependencies (bun install)..." -ForegroundColor Yellow
Push-Location $locoRoot
try {
    bun install
    Write-Host "  ✓ agent dependencies installed" -ForegroundColor Green
} catch {
    Write-Host "  ⚠ bun install failed: $_" -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location

# --- Step 5: Install All-IN-ONE CLI ---
Write-Host "[5/5] Installing All-IN-ONE CLI..." -ForegroundColor Yellow
try {
    pip install all-in-one-aione
    aione setup
    Write-Host "  ✓ All-IN-ONE CLI installed" -ForegroundColor Green
} catch {
    Write-Host "  ⚠ All-IN-ONE install failed: $_" -ForegroundColor Red
    Write-Host "  Manual: pip install all-in-one-aione && aione setup" -ForegroundColor White
}

# --- Done ---
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Setup Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "  1. Edit agent\.env and add your DeepSeek API key" -ForegroundColor White
Write-Host "  2. Configure Weibo cookies:" -ForegroundColor White
Write-Host "     aione auth weibo set-cookie --profile web --cookie `"<cookie>`"" -ForegroundColor White
Write-Host "     aione auth weibo set-cookie --profile creator --cookie `"<cookie>`"" -ForegroundColor White
Write-Host "  3. Launch Chrome for Weibo:" -ForegroundColor White
Write-Host "     cd agent && bun run setup-chrome --target weibo" -ForegroundColor White
Write-Host "     (Log into weibo.com in the opened Chrome window)" -ForegroundColor White
Write-Host "  4. Health check:" -ForegroundColor White
Write-Host "     cd agent && bun run doctor --check-cdp" -ForegroundColor White
Write-Host "  5. Start the agent:" -ForegroundColor White
Write-Host "     cd agent && bun start" -ForegroundColor White
Write-Host "  6. Test with a task:" -ForegroundColor White
Write-Host '     bun start -p "/weibo 搜索AI相关的最新微博，并查看热门内容"' -ForegroundColor White
Write-Host ""
