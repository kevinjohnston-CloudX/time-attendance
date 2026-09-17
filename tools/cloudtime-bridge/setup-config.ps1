<#
  Builds config.json for the CloudTime bridge.

  Run this on bltix, from the folder holding bridge.mjs. It copies the Oracle
  connection settings from the CXT ticketing bridge already running on this
  machine — those values are proven to reach this exact database from this
  exact box, so retyping them by hand only invites a typo — generates a fresh
  bridge secret, and writes the file.

    powershell -ExecutionPolicy Bypass -File .\setup-config.ps1

  Two Windows-specific traps this avoids, both of which fail as a confusing
  "Bad escaped character in JSON":
    - Windows paths need doubled backslashes inside JSON.
    - Set-Content -Encoding utf8 writes a byte-order mark on PowerShell 5.1,
      and Node's JSON.parse rejects it.

  -CxtConfig   path to the CXT bridge's config.json, if it is not in the
               default location.
  -BaseUrl     the CloudTime host.
  -Force       overwrite an existing config.json.
#>
param(
  [string]$CxtConfig = "C:\cxt\wms-bridge\config.json",
  [string]$BaseUrl = "https://time-attendance-txzz.vercel.app",
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = Join-Path $Here "config.json"

if ((Test-Path $target) -and -not $Force) {
  throw "config.json already exists. Inspect it first, then rerun with -Force to replace it."
}

# ---- Oracle settings, from the bridge that already works on this box --------
if (-not (Test-Path $CxtConfig)) {
  throw @"
Could not find the CXT bridge config at:
  $CxtConfig

Find it with:  Get-ScheduledTask CXT-wms-bridge | Select-Object -ExpandProperty Actions
then rerun:    .\setup-config.ps1 -CxtConfig <path to that config.json>
"@
}

try {
  $cxt = Get-Content -Raw -Path $CxtConfig | ConvertFrom-Json
} catch {
  throw "The CXT config at $CxtConfig is not valid JSON: $($_.Exception.Message)"
}

if (-not $cxt.oracle -or -not $cxt.oracle.connectString) {
  throw "The CXT config has no oracle.connectString to copy."
}

Write-Host "Reusing Oracle settings from the CXT bridge:" -ForegroundColor Cyan
Write-Host "  connectString : $($cxt.oracle.connectString)"
Write-Host "  user          : $($cxt.oracle.user)"
if ($cxt.oracle.clientLibDir) {
  Write-Host "  clientLibDir  : $($cxt.oracle.clientLibDir)"
  if (-not (Test-Path $cxt.oracle.clientLibDir)) {
    Write-Warning "That Instant Client folder does not exist. Check the path before running the bridge."
  }
} else {
  Write-Host "  clientLibDir  : (none - CXT runs in thin mode, so this bridge can too)"
}

# ---- A fresh secret, never CXT's -------------------------------------------
# Separate secrets are the whole point of running two bridges: one being
# rotated or compromised must not reach the other.
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$secret = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""

# ---- Compose ---------------------------------------------------------------
$oracle = [ordered]@{
  user          = $cxt.oracle.user
  password      = $cxt.oracle.password
  connectString = $cxt.oracle.connectString
}
if ($cxt.oracle.clientLibDir) { $oracle.clientLibDir = $cxt.oracle.clientLibDir }

$config = [ordered]@{
  cloudTimeBaseUrl = $BaseUrl.TrimEnd("/")
  bridgeSecret     = $secret
  pollSeconds      = 60
  oracle           = $oracle
}

# ConvertTo-Json escapes the backslashes; WriteAllText with an explicit
# no-BOM encoding keeps Node's JSON.parse happy.
$json = $config | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($target, $json, (New-Object System.Text.UTF8Encoding($false)))

# ---- Prove it parses the way the bridge will read it ------------------------
# Before the ACL is tightened, not after: locking the file first would deny the
# very check that is meant to confirm it, and would lock a non-elevated
# operator out of the file they just created.
$node = (Get-Command node -ErrorAction SilentlyContinue)
if ($node) {
  # The path goes in as an argument rather than inside the script string: the
  # shell's working directory is not necessarily this folder, and a Windows
  # path embedded in a JS string literal would need escaping of its own.
  $check = & node -e "const c=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log('OK '+c.cloudTimeBaseUrl+' | '+c.oracle.connectString)" $target 2>&1
  if ($LASTEXITCODE -ne 0) { throw "config.json was written but Node cannot parse it: $check" }
  Write-Host ""
  Write-Host "config.json written and verified: $check" -ForegroundColor Green
} else {
  Write-Warning "Node is not on PATH, so the file could not be verified. Install Node 20+ before running the bridge."
}

# ---- Restrict it: the file holds the Oracle password ------------------------
# The bridge itself runs as SYSTEM. The current user is kept on the ACL so this
# works whether or not the shell is elevated; install-cloudtime-bridge.ps1
# re-applies the stricter SYSTEM + Administrators set at install time.
$me = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
icacls $target /inheritance:r /grant "SYSTEM:R" /grant "BUILTIN\Administrators:F" /grant "${me}:R" | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Warning "Could not restrict config.json. It holds the Oracle password - check its permissions by hand."
}

Write-Host ""
Write-Host "==================================================================" -ForegroundColor Yellow
Write-Host " Put this SAME value in Vercel as the BRIDGE_SECRET env var:" -ForegroundColor Yellow
Write-Host ""
Write-Host "   $secret"
Write-Host ""
Write-Host " Until it is set there, CloudTime answers 503 and the bridge is" -ForegroundColor Yellow
Write-Host " refused. That does NOT block 'node bridge.mjs --dry-run'." -ForegroundColor Yellow
Write-Host "==================================================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "Next:  node bridge.mjs --dry-run"
