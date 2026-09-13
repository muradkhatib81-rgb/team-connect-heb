param(
  [switch]$SkipSync
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not $root) { $root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path }
Set-Location $root

if (-not $env:ANDROID_HOME) {
  $sdk = Join-Path $env:LOCALAPPDATA "Android\Sdk"
  if (Test-Path $sdk) { $env:ANDROID_HOME = $sdk; $env:ANDROID_SDK_ROOT = $sdk }
}

$props = Join-Path $root "android\keystore.properties"
$jks = Join-Path $root "android\team-connect-release.jks"
if (-not (Test-Path $props)) { throw "Missing android\keystore.properties. Restore from backup before building release." }
if (-not (Test-Path $jks)) { throw "Missing android\team-connect-release.jks. Restore from backup before building release." }

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

$candidates = @(
  (Join-Path $env:TEMP "tc-android-build\app\outputs\bundle\release\app-release.aab"),
  (Join-Path $root "android\app\build\outputs\bundle\release\app-release.aab")
)
$aab = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $aab) { throw "AAB not found in expected output locations." }
Write-Host "OK: $aab"
$destDir = Join-Path $env:USERPROFILE "OneDrive\Documents\TeamConnect-Play-Release"
New-Item -ItemType Directory -Force -Path $destDir | Out-Null
Copy-Item $aab (Join-Path $destDir "TeamConnect-release.aab") -Force
Write-Host "Copied to: $(Join-Path $destDir 'TeamConnect-release.aab')"