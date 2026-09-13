param(
  [switch]$SkipSync
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not $root) { $root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path }
Set-Location $root

$props = Join-Path $root "android\keystore.properties"
$jks = Join-Path $root "android\team-connect-release.jks"
if (-not (Test-Path $props)) { throw "Missing android\keystore.properties — restore from your backup before building release." }
if (-not (Test-Path $jks)) { throw "Missing android\team-connect-release.jks — restore from your backup before building release." }

if (-not $SkipSync) {
  npx cap sync android
  if ($LASTEXITCODE -ne 0) { throw "cap sync android failed" }
}

Push-Location (Join-Path $root "android")
try {
  .\gradlew.bat bundleRelease --no-daemon
  if ($LASTEXITCODE -ne 0) { throw "gradlew bundleRelease failed" }
} finally {
  Pop-Location
}

$aab = Join-Path $root "android\app\build\outputs\bundle\release\app-release.aab"
if (-not (Test-Path $aab)) { throw "AAB not found at $aab" }
Write-Host "OK: $aab"