<#
.SYNOPSIS
  Sends BF Bot Manager's bet history exports to Surge Bot, so the Reconcile page shows real results.

.DESCRIPTION
  Run this on the PC that runs BF Bot Manager, every 15 minutes or so from Windows Task Scheduler. It looks in one
  folder for CSV files and posts each new or changed one to the site's import link. Files it has already sent, and
  not changed since, are skipped (it remembers them in bf-import-state.json beside this script). Sending a file twice
  is harmless anyway: the site recognises bets by their bet id.

  Works in Windows PowerShell 5.1 (built into Windows) and PowerShell 7.

.PARAMETER Folder
  The folder BF Bot Manager saves its bet history exports into.

.PARAMETER Url
  The import link: https://<your site>/imports/betfair/<BETFAIR_IMPORT_TOKEN>. Keep it secret, like the bet feed link.

.PARAMETER Days
  Only files changed in this many days are looked at. Default 7.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File bf-import.ps1 -Folder "C:\BFBotManager\Exports" -Url "https://example.com/imports/betfair/abc..."
#>
param(
  [Parameter(Mandatory = $true)][string]$Folder,
  [Parameter(Mandatory = $true)][string]$Url,
  [int]$Days = 7
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$stateFile = Join-Path $PSScriptRoot "bf-import-state.json"
$state = @{}
if (Test-Path $stateFile) {
  $saved = Get-Content $stateFile -Raw | ConvertFrom-Json
  foreach ($p in $saved.PSObject.Properties) { $state[$p.Name] = $p.Value }
}

if (-not (Test-Path $Folder)) {
  Write-Error "Folder not found: $Folder"
  exit 1
}

$since = (Get-Date).AddDays(-$Days)
$files = Get-ChildItem -Path $Folder -File | Where-Object { $_.Extension -in ".csv", ".txt" -and $_.LastWriteTime -ge $since } | Sort-Object LastWriteTime
$failed = 0

foreach ($f in $files) {
  $stamp = "$($f.Length)|$($f.LastWriteTimeUtc.ToString('o'))"
  if ($state[$f.FullName] -eq $stamp) { continue }

  # Skip a file BF Bot Manager is still writing: it must be unchanged for a minute.
  if ($f.LastWriteTime -gt (Get-Date).AddMinutes(-1)) { continue }

  try {
    $bytes = [IO.File]::ReadAllBytes($f.FullName)
    # BF Bot Manager writes times in this PC's time zone, so say which: minutes ahead of UTC (60 in UK summer time).
    $offset = [int][TimeZoneInfo]::Local.GetUtcOffset($f.LastWriteTime).TotalMinutes
    $target = "$Url`?name=$([Uri]::EscapeDataString($f.Name))&utcOffset=$offset"
    $result = Invoke-RestMethod -Method Post -Uri $target -Body $bytes -ContentType "text/csv; charset=utf-8" -TimeoutSec 60
    Write-Output ("{0}: {1} bets, {2} new, {3} linked to picks" -f $f.Name, $result.rows, $result.added, $result.linked)
    $state[$f.FullName] = $stamp
  } catch {
    $failed++
    $detail = $_.ErrorDetails.Message
    # Windows PowerShell 5.1 often leaves ErrorDetails empty; the site's reason is then in the response body.
    if (-not $detail -and $_.Exception.Response) {
      try { $detail = (New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() } catch { }
    }
    Write-Warning ("{0}: not imported. {1} {2}" -f $f.Name, $_.Exception.Message, $detail)
    # A file the site can't read (wrong export) is remembered too, so it isn't retried every run; change it to retry.
    if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 422) { $state[$f.FullName] = $stamp }
  }
}

$state | ConvertTo-Json | Set-Content -Path $stateFile -Encoding UTF8
if ($failed -gt 0) { exit 1 }
