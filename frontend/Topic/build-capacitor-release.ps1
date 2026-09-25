[CmdletBinding()]
param(
    [string]$SdkRoot,
    [string]$JavaHome,
    [string]$Keystore,
    [string]$KeyAlias = 'stock_lighthouse',
    [string]$KeystorePassword,
    [string]$KeyPassword,
    [string]$BuildToolsVersion = '36.0.0',
    [string]$Output = 'build/stock-lighthouse-capacitor-release.apk'
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path $PSScriptRoot).Path
$AndroidRoot = Join-Path $ProjectRoot 'android'

function Resolve-ExistingPath([string]$Path, [string]$Label) {
    if (-not $Path -or -not (Test-Path -LiteralPath $Path)) {
        throw "$Label not found: $Path"
    }
    return (Resolve-Path -LiteralPath $Path).Path
}

function Invoke-Native([string]$FilePath, [string[]]$Arguments) {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
    }
}

if (-not $SdkRoot) {
    $SdkRoot = $env:ANDROID_SDK_ROOT
}
if (-not $SdkRoot) {
    $SdkRoot = $env:ANDROID_HOME
}
if (-not $SdkRoot -and (Test-Path "$env:LOCALAPPDATA\Android\Sdk")) {
    $SdkRoot = "$env:LOCALAPPDATA\Android\Sdk"
}
if (-not $SdkRoot -and (Test-Path "$env:TEMP\stock-lighthouse-apk-build\sdk")) {
    $SdkRoot = "$env:TEMP\stock-lighthouse-apk-build\sdk"
}

if (-not $JavaHome -and (Test-Path 'C:\Program Files\Java\jdk-21.0.10')) {
    $JavaHome = 'C:\Program Files\Java\jdk-21.0.10'
}
if (-not $JavaHome) {
    $JavaHome = $env:JAVA_HOME
}

$SdkRoot = Resolve-ExistingPath $SdkRoot 'Android SDK'
$JavaHome = Resolve-ExistingPath $JavaHome 'Java SDK'
$Gradle = Resolve-ExistingPath (Join-Path $AndroidRoot 'gradlew.bat') 'Capacitor Gradle wrapper'
$Apksigner = Resolve-ExistingPath (Join-Path $SdkRoot "build-tools\$BuildToolsVersion\apksigner.bat") 'apksigner'
$Zipalign = Resolve-ExistingPath (Join-Path $SdkRoot "build-tools\$BuildToolsVersion\zipalign.exe") 'zipalign'

if (-not $Keystore) {
    $Keystore = Join-Path $env:TEMP 'stock-lighthouse-apk-build\wrapper\stock-lighthouse-release.keystore'
}
$Keystore = Resolve-ExistingPath $Keystore 'Release keystore'

if (-not $KeystorePassword) {
    $KeystorePassword = Read-Host 'Keystore password'
}
if (-not $KeyPassword) {
    $KeyPassword = $KeystorePassword
}

$env:JAVA_HOME = $JavaHome
$env:ANDROID_HOME = $SdkRoot
$env:ANDROID_SDK_ROOT = $SdkRoot

$OutputPath = Join-Path $ProjectRoot $Output
$OutputDirectory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

Push-Location $ProjectRoot
$PreviousCapacitorBuild = $env:CAPACITOR_BUILD
$env:CAPACITOR_BUILD = '1'
try {
    Invoke-Native 'npm.cmd' @('run', 'build')
    Invoke-Native 'npx.cmd' @('cap', 'sync', 'android')
}
finally {
    if ($null -eq $PreviousCapacitorBuild) {
        Remove-Item Env:CAPACITOR_BUILD -ErrorAction SilentlyContinue
    }
    else {
        $env:CAPACITOR_BUILD = $PreviousCapacitorBuild
    }
    Pop-Location
}

Push-Location $AndroidRoot
try {
    Invoke-Native $Gradle @('--no-daemon', '--console=plain', 'assembleRelease')
}
finally {
    Pop-Location
}

$UnsignedApk = Join-Path $AndroidRoot 'app\build\outputs\apk\release\app-release-unsigned.apk'
$UnsignedApk = Resolve-ExistingPath $UnsignedApk 'Unsigned release APK'

Invoke-Native $Apksigner @(
    'sign',
    '--ks', $Keystore,
    '--ks-key-alias', $KeyAlias,
    '--ks-pass', "pass:$KeystorePassword",
    '--key-pass', "pass:$KeyPassword",
    '--out', $OutputPath,
    $UnsignedApk
)

Invoke-Native $Apksigner @('verify', '--verbose', $OutputPath)
Invoke-Native $Zipalign @('-c', '-v', '4', $OutputPath)

$Hash = (Get-FileHash -LiteralPath $OutputPath -Algorithm SHA256).Hash
Write-Output "Release APK: $OutputPath"
Write-Output "SHA-256: $Hash"
