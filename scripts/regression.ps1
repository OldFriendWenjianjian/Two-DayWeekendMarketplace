$ErrorActionPreference = 'Stop'

function Invoke-Checked {
    param([string]$FilePath, [string[]]$ArgumentList)
    Write-Host ">> $FilePath $($ArgumentList -join ' ')"
    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed: $FilePath"
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
    $env:ANDROID_HOME = 'C:\Users\a1258\AppData\Local\Android\Sdk'
    $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
    $env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
    Push-Location 'android'
    try {
        Invoke-Checked '.\gradlew.bat' @('assembleDebug')
    }
    finally {
        Pop-Location
    }
} elseif (Test-Path 'android/app/build.gradle') {
    $gradle = 'C:\Users\a1258\.gradle\wrapper\dists\gradle-8.7-bin\bhs2wmbdwecv87pi65oeuq5iu\gradle-8.7\bin\gradle.bat'
    if (Test-Path $gradle) {
        $env:ANDROID_HOME = 'C:\Users\a1258\AppData\Local\Android\Sdk'
        $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
        $env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
        Push-Location 'android'
        try {
            Invoke-Checked $gradle @('--no-daemon', ':app:assembleDebug')
        }
        finally {
            Pop-Location
        }
        Copy-Item -Force -LiteralPath 'android\app\build\outputs\apk\debug\app-debug.apk' -Destination 'server\public\download\two-day-weekend-marketplace.apk'
    } else {
        throw "Gradle not found at $gradle"
    }
}

Write-Host 'Regression checks completed.'
