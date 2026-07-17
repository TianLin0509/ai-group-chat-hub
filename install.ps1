#Requires -Version 5.1
<#
  AI Group Chat Hub - one-click installer
  ------------------------------------------------------------
  Usage (run in the project root):
    Right-click this file -> "Run with PowerShell", or:
    powershell -ExecutionPolicy Bypass -File install.ps1

  What it does:
    1) Check Node.js (needs 20+)
    2) npm install (downloads the Electron runtime)
    3) Create a desktop shortcut
  After it finishes, double-click the desktop shortcut to launch.
  (Script is ASCII-only on purpose so Windows PowerShell 5.1 parses it
   correctly regardless of system code page.)
#>
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

Write-Host ""
Write-Host "==================================" -ForegroundColor Cyan
Write-Host "   AI Group Chat Hub  -  Installer" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host "Project dir: $root"
Write-Host ""

# 1) Check Node.js
$nodeV = $null
try { $nodeV = (& node -v) 2>$null } catch {}
if (-not $nodeV) {
  Write-Host "[X] Node.js not found. Please install Node.js 20+ first:" -ForegroundColor Red
  Write-Host "    https://nodejs.org/  (download the LTS build, then reopen the terminal)" -ForegroundColor Red
  exit 1
}
$major = 0
try { $major = [int]($nodeV.TrimStart('v').Split('.')[0]) } catch {}
if ($major -lt 20) {
  Write-Host "[X] Node.js too old (found $nodeV), needs 20+. Please upgrade and retry." -ForegroundColor Red
  exit 1
}
Write-Host "[OK] Node.js $nodeV" -ForegroundColor Green

# 2) Install dependencies
# Electron's postinstall downloads a ~100MB binary from GitHub, which is
# unreliable in some networks (e.g. mainland China). Point it at the npmmirror
# CDN unless the user already configured a mirror themselves.
if (-not $env:ELECTRON_MIRROR) { $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/" }
Write-Host "[..] Installing dependencies (first run ~1-3 min, downloads Electron)..." -ForegroundColor Yellow
Push-Location $root
try {
  & npm install
  if ($LASTEXITCODE -ne 0) { throw "npm install exited with code $LASTEXITCODE" }
} finally {
  Pop-Location
}
$electron = Join-Path $root "node_modules\electron\dist\electron.exe"
if (-not (Test-Path $electron)) {
  Write-Host "[X] Dependencies installed but Electron not found ($electron). Check npm errors above." -ForegroundColor Red
  exit 1
}
Write-Host "[OK] Dependencies installed" -ForegroundColor Green

# 3) Desktop shortcut
try {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $lnk = Join-Path $desktop "AI Group Chat Hub.lnk"
  $ico = Join-Path $root "claude-wx.ico"
  $ws = New-Object -ComObject WScript.Shell
  $sc = $ws.CreateShortcut($lnk)
  $sc.TargetPath = $electron
  $sc.Arguments = "`"$root`""
  $sc.WorkingDirectory = $root
  if (Test-Path $ico) { $sc.IconLocation = $ico }
  $sc.Description = "AI Group Chat Hub"
  $sc.Save()
  Write-Host "[OK] Desktop shortcut created: $lnk" -ForegroundColor Green
} catch {
  Write-Host "[!] Shortcut creation failed (not fatal): $($_.Exception.Message)" -ForegroundColor Yellow
  Write-Host "    You can also just run start.bat to launch." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========== Done ==========" -ForegroundColor Green
Write-Host "Launch: double-click the desktop 'AI Group Chat Hub', or run start.bat"
Write-Host "First launch shows a welcome guide: it detects which AI CLIs you have"
Write-Host "and tells you what still needs installing / configuring."
Write-Host ""
