$ErrorActionPreference = 'Stop'

function Invoke-Checked {
    param([string]$FilePath, [string[]]$ArgumentList)
    Write-Host ">> $FilePath $($ArgumentList -join ' ')"
    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed: $FilePath"
    }
}

function Set-AndroidBuildEnv {
    if (-not $env:ANDROID_HOME) {
        $env:ANDROID_HOME = 'C:\Users\a1258\AppData\Local\Android\Sdk'
    }
    if (-not $env:ANDROID_SDK_ROOT) {
        $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
    }
    if (-not $env:JAVA_HOME -and (Test-Path 'C:\Program Files\Android\Android Studio\jbr')) {
        $env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
    }
}

function Resolve-Gradle {
    param([string]$ProjectPath)
    $wrapper = Join-Path $ProjectPath 'gradlew.bat'
    if (Test-Path $wrapper) {
        return (Resolve-Path $wrapper).Path
    }
    if ($env:TDWM_GRADLE -and (Test-Path $env:TDWM_GRADLE)) {
        return $env:TDWM_GRADLE
    }
    $command = Get-Command 'gradle' -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }
    $cached = 'C:\Users\a1258\.gradle\wrapper\dists\gradle-8.7-bin\bhs2wmbdwecv87pi65oeuq5iu\gradle-8.7\bin\gradle.bat'
    if (Test-Path $cached) {
        return $cached
    }
    throw "Gradle not found. Install Gradle, add gradlew.bat, or set TDWM_GRADLE."
}

function Resolve-Aapt {
    if (-not $env:ANDROID_HOME) {
        Set-AndroidBuildEnv
    }
    $preferred = Join-Path $env:ANDROID_HOME 'build-tools\34.0.0\aapt.exe'
    if (Test-Path $preferred) {
        return $preferred
    }
    $tool = Get-ChildItem -LiteralPath (Join-Path $env:ANDROID_HOME 'build-tools') -Recurse -Filter 'aapt.exe' -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending |
        Select-Object -First 1
    if ($tool) {
        return $tool.FullName
    }
    throw "aapt.exe not found under ANDROID_HOME."
}

function Test-ApkIdentity {
    param(
        [string]$ApkPath,
        [string]$ExpectedPackage,
        [string]$ExpectedLabel
    )
    $aapt = Resolve-Aapt
    $badging = & $aapt dump badging $ApkPath
    if ($LASTEXITCODE -ne 0) {
        throw "aapt failed for $ApkPath"
    }
    if (-not ($badging | Select-String -SimpleMatch "package: name='$ExpectedPackage'" -Quiet)) {
        throw "APK package mismatch. Expected $ExpectedPackage."
    }
    if (-not ($badging | Select-String -SimpleMatch "application-label:'$ExpectedLabel'" -Quiet)) {
        throw "APK label mismatch. Expected $ExpectedLabel."
    }
}

if (Test-Path 'scripts/generate_branding.py') {
    Invoke-Checked 'python' @('scripts/generate_branding.py')
}
if (Test-Path 'server/package.json') {
    Invoke-Checked 'npm' @('--prefix', 'server', 'install')
    Invoke-Checked 'npm' @('--prefix', 'server', 'test')
}
if (Test-Path 'web/package.json') {
    Invoke-Checked 'npm' @('--prefix', 'web', 'install')
    Invoke-Checked 'npm' @('--prefix', 'web', 'test')
    Invoke-Checked 'npm' @('--prefix', 'web', 'run', 'build')
}
if (Test-Path 'android/gradlew.bat') {
    Set-AndroidBuildEnv
    Push-Location 'android'
    try {
        Invoke-Checked '.\gradlew.bat' @('assembleDebug')
    }
    finally {
        Pop-Location
    }
} elseif (Test-Path 'android/app/build.gradle') {
    Set-AndroidBuildEnv
    $gradle = Resolve-Gradle 'android'
    Push-Location 'android'
    try {
        Invoke-Checked $gradle @('--no-daemon', ':app:assembleDebug')
    }
    finally {
        Pop-Location
    }
}

if (Test-Path 'android-native/app/build.gradle') {
    Set-AndroidBuildEnv
    $gradle = Resolve-Gradle 'android-native'
    Push-Location 'android-native'
    try {
        Invoke-Checked $gradle @('--no-daemon', ':app:assembleDebug')
    }
    finally {
        Pop-Location
    }
    New-Item -ItemType Directory -Force -Path 'server\public\download' | Out-Null
    Copy-Item -Force -LiteralPath 'android-native\app\build\outputs\apk\debug\app-debug.apk' -Destination 'server\public\download\two-day-weekend-marketplace.apk'
    Test-ApkIdentity 'server\public\download\two-day-weekend-marketplace.apk' 'com.twodayweekend.marketplace.nativeapp' '双休超市'
}

Write-Host 'Regression checks completed.'
