<#
  Installs the CloudTime WMS bridge as a Windows scheduled task that starts at
  boot and restarts itself if it dies. Run as Administrator from the folder that
  already holds bridge.mjs, node_modules and a filled-in config.json.

    powershell -ExecutionPolicy Bypass -File .\install-cloudtime-bridge.ps1
    powershell -ExecutionPolicy Bypass -File .\install-cloudtime-bridge.ps1 -Uninstall

  This is the same installer the CXT ticketing bridge uses, with a different task
  name and folder. The two are deliberately separate tasks with separate configs
  and separate secrets: the ticketing bridge routes carrier email, this one
  carries payroll data, and neither should be able to take the other down.

  -NodeExe lets you point at a portable node.exe when Node is not on PATH.
#>
param(
  [string]$NodeExe = "node",
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$TaskName = "CloudTime-wms-bridge"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Removed scheduled task $TaskName."
  exit 0
}

$cfgPath = Join-Path $Here "config.json"
if (-not (Test-Path $cfgPath)) {
  throw "config.json not found next to this script. Copy config.example.json to config.json and fill it in first."
}
if (-not (Test-Path (Join-Path $Here "node_modules"))) {
  throw "node_modules not found. Run 'npm install' here (or copy the folder from a machine that can), then rerun."
}

# Catch a malformed config now rather than as a restart loop at boot. The bridge
# JSON.parses this file as its very first act, so a stray single backslash in a
# Windows path fails the task with nothing useful in the event log.
try {
  $cfg = Get-Content -Raw -Path $cfgPath | ConvertFrom-Json
} catch {
  throw "config.json is not valid JSON: $($_.Exception.Message)`nWindows paths need doubled backslashes, e.g. C:\\oracle\\instantclient_19_28"
}
foreach ($field in @("cloudTimeBaseUrl", "bridgeSecret")) {
  if (-not $cfg.$field) { throw "config.json is missing '$field'." }
}
if (-not $cfg.oracle -or -not $cfg.oracle.connectString) {
  throw "config.json is missing 'oracle.connectString'."
}
if ($cfg.bridgeSecret -like "SAME-VALUE-AS-*") {
  throw "config.json still holds the placeholder bridgeSecret. Set it to the same value as BRIDGE_SECRET in CloudTime's environment."
}

# Resolve node: PATH name or explicit path.
$node = $NodeExe
if ($NodeExe -eq "node") {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $cmd) { throw "Node.js not found on PATH. Install Node 22 LTS or pass -NodeExe C:\path\to\node.exe" }
  $node = $cmd.Source
}

# Only SYSTEM and Administrators may read the config: it holds the Oracle
# password and the CloudTime bridge secret in plain text.
icacls $cfgPath /inheritance:r /grant "SYSTEM:R" /grant "BUILTIN\Administrators:F" | Out-Null

$action = New-ScheduledTaskAction -Execute $node -Argument "bridge.mjs" -WorkingDirectory $Here
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
  -MultipleInstances IgnoreNew `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Days 3650) `
  -StartWhenAvailable

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host "Installed and started $TaskName."
Write-Host "Logs: $Here\logs\  (one file per month)"
Write-Host "Health: bridge_agents.lastSeenAt for 'cloudtime-wms' in CloudTime should update within a minute."
Write-Host ""
Write-Host "Rotating the secret: change BRIDGE_SECRET in CloudTime, mirror it in config.json, then"
Write-Host "  Stop-ScheduledTask $TaskName; Start-ScheduledTask $TaskName"
