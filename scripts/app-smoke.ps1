param(
    [switch]$RequireDevice,
    [string]$ApkPath = 'android-native\app\build\outputs\apk\debug\app-debug.apk',
    [string]$PackageName = 'com.twodayweekend.marketplace.nativeapp',
    [string]$ActivityName = '.NativeMainActivity',
    [string]$ExpectedLabel = '双休超市',
    [string]$DownloadApiUrl = 'http://[2402:4e00:c013:8600:5602:3dc2:a2d0:0]/shc-20260520-a1faaf/weekend-marketplace/api/download',
    [string]$DownloadApkUrl = 'http://[2402:4e00:c013:8600:5602:3dc2:a2d0:0]/shc-20260520-a1faaf/weekend-marketplace/download/two-day-weekend-marketplace.apk',
    [string]$AdbPath = 'C:/Users/a1258/AppData/Local/Android/Sdk/platform-tools/adb.exe',
    [string]$ArtifactsDir = 'artifacts'
)

$ErrorActionPreference = 'Stop'
$script:FailCount = 0
$script:WarnCount = 0

function Write-Result {
    param(
        [ValidateSet('PASS', 'WARN', 'FAIL')]
        [string]$Level,
        [string]$Message
    )
    if ($Level -eq 'FAIL') { $script:FailCount++ }
    if ($Level -eq 'WARN') { $script:WarnCount++ }
    Write-Host "[$Level] $Message"
}

function Invoke-Captured {
    param(
        [string]$FilePath,
        [string[]]$ArgumentList
    )
    $output = & $FilePath @ArgumentList 2>&1
    $exitCode = $LASTEXITCODE
    [pscustomobject]@{
        ExitCode = $exitCode
        Output = @($output | ForEach-Object { $_.ToString() })
        Text = (@($output | ForEach-Object { $_.ToString() }) -join "`n")
    }
}

function Resolve-AndroidTool {
    param([string[]]$Names)
    $roots = @()
    if ($env:ANDROID_HOME) { $roots += $env:ANDROID_HOME }
    if ($env:ANDROID_SDK_ROOT -and $env:ANDROID_SDK_ROOT -notin $roots) { $roots += $env:ANDROID_SDK_ROOT }
    $defaultSdk = 'C:\Users\a1258\AppData\Local\Android\Sdk'
    if ($defaultSdk -notin $roots) { $roots += $defaultSdk }

    foreach ($root in $roots) {
        $buildTools = Join-Path $root 'build-tools'
        if (-not (Test-Path -LiteralPath $buildTools)) { continue }
        foreach ($name in $Names) {
            $tool = Get-ChildItem -LiteralPath $buildTools -Recurse -Filter $name -ErrorAction SilentlyContinue |
                Sort-Object FullName -Descending |
                Select-Object -First 1
            if ($tool) { return $tool.FullName }
        }
    }
    return $null
}

function Get-ApkMetadataFromAapt {
    param([string]$ResolvedApk)
    $tool = Resolve-AndroidTool @('aapt.exe', 'aapt2.exe')
    if (-not $tool) {
        return $null
    }

    $result = Invoke-Captured $tool @('dump', 'badging', $ResolvedApk)
    if ($result.ExitCode -ne 0) {
        Write-Result 'WARN' "Android build-tools metadata dump failed with $([IO.Path]::GetFileName($tool)): $($result.Text)"
        return $null
    }

    $badging = $result.Output
    $packageLine = $badging | Where-Object { $_ -like 'package: name=*' } | Select-Object -First 1
    $labelLine = $badging | Where-Object { $_ -like 'application-label:*' } | Select-Object -First 1
    $package = $null
    $versionCode = $null
    $versionName = $null
    $label = $null
    if ($packageLine -match "name='([^']+)'") { $package = $Matches[1] }
    if ($packageLine -match "versionCode='([^']+)'") { $versionCode = $Matches[1] }
    if ($packageLine -match "versionName='([^']+)'") { $versionName = $Matches[1] }
    if ($labelLine -match "application-label:'([^']*)'") { $label = $Matches[1] }

    [pscustomobject]@{
        Source = [IO.Path]::GetFileName($tool)
        PackageName = $package
        VersionCode = $versionCode
        VersionName = $versionName
        Label = $label
    }
}

function Get-ApkMetadataFallback {
    param([string]$ResolvedApk)
    $apkDirectory = Split-Path -Parent $ResolvedApk
    $metadataPath = Join-Path $apkDirectory 'output-metadata.json'
    $projectManifest = 'android-native\app\src\main\AndroidManifest.xml'
    $stringsPath = 'android-native\app\src\main\res\values\strings.xml'

    $package = $null
    $versionCode = $null
    $versionName = $null
    $label = $null

    if (Test-Path -LiteralPath $metadataPath) {
        $metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
        $package = $metadata.applicationId
        $firstElement = @($metadata.elements)[0]
        if ($firstElement) {
            $versionCode = $firstElement.versionCode
            $versionName = $firstElement.versionName
        }
    }

    if (Test-Path -LiteralPath $projectManifest) {
        [xml]$manifest = Get-Content -LiteralPath $projectManifest -Raw
        $appNode = $manifest.manifest.application
        $androidNs = 'http://schemas.android.com/apk/res/android'
        $labelRef = $appNode.GetAttribute('label', $androidNs)
        if ($labelRef -and $labelRef.StartsWith('@string/') -and (Test-Path -LiteralPath $stringsPath)) {
            [xml]$strings = Get-Content -LiteralPath $stringsPath -Raw
            $name = $labelRef.Substring('@string/'.Length)
            $stringNode = $strings.resources.string | Where-Object { $_.name -eq $name } | Select-Object -First 1
            if ($stringNode) { $label = $stringNode.InnerText }
        } elseif ($labelRef) {
            $label = $labelRef
        }
    }

    [pscustomobject]@{
        Source = 'output-metadata.json + source manifest fallback'
        PackageName = $package
        VersionCode = $versionCode
        VersionName = $versionName
        Label = $label
    }
}

function Test-LocalApk {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        Write-Result 'FAIL' "APK not found: $Path. Build it first, for example: pwsh -NoProfile -File scripts\regression.ps1 or run android-native :app:assembleDebug."
        return $null
    }

    $resolved = (Resolve-Path -LiteralPath $Path).Path
    $sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $resolved).Hash.ToLowerInvariant()
    Write-Result 'PASS' "Local APK exists: $resolved"
    Write-Result 'PASS' "Local APK sha256: $sha256"

    $metadata = Get-ApkMetadataFromAapt $resolved
    if (-not $metadata) {
        $metadata = Get-ApkMetadataFallback $resolved
        Write-Result 'WARN' "aapt/aapt2 metadata unavailable; using fallback metadata from Gradle output/source manifest. This does not decode the APK manifest directly."
    }

    Write-Host "      package: $($metadata.PackageName)"
    Write-Host "      versionCode: $($metadata.VersionCode)"
    Write-Host "      versionName: $($metadata.VersionName)"
    Write-Host "      label: $($metadata.Label)"
    Write-Host "      metadataSource: $($metadata.Source)"

    if ($metadata.PackageName -ne $PackageName) {
        Write-Result 'FAIL' "APK package mismatch. Expected $PackageName, got $($metadata.PackageName)."
    } else {
        Write-Result 'PASS' "APK package matches $PackageName."
    }
    if ($metadata.Label -ne $ExpectedLabel) {
        Write-Result 'FAIL' "APK label mismatch. Expected $ExpectedLabel, got $($metadata.Label)."
    } else {
        Write-Result 'PASS' "APK label matches $ExpectedLabel."
    }

    [pscustomobject]@{
        Path = $resolved
        Sha256 = $sha256
        Metadata = $metadata
    }
}

function Test-RemoteDownload {
    try {
        $metadata = Invoke-RestMethod -Uri $DownloadApiUrl -TimeoutSec 30
        Write-Result 'PASS' "Remote download API reachable: $DownloadApiUrl"
        Write-Host "      remote package: $($metadata.packageName)"
        Write-Host "      remote versionCode: $($metadata.versionCode)"
        Write-Host "      remote versionName: $($metadata.versionName)"
        Write-Host "      remote sha256: $($metadata.sha256)"
        if ($metadata.packageName -ne $PackageName) {
            Write-Result 'FAIL' "Remote package mismatch. Expected $PackageName, got $($metadata.packageName)."
        }
        if (-not ($metadata.sha256 -match '^[a-fA-F0-9]{64}$')) {
            Write-Result 'FAIL' "Remote sha256 is missing or invalid: $($metadata.sha256)"
        }
    } catch {
        Write-Result 'FAIL' "Remote download API is not reachable; no remote version/sha256 was inferred. $($_.Exception.Message)"
    }

    try {
        $response = Invoke-WebRequest -Uri $DownloadApkUrl -Method Head -UseBasicParsing -TimeoutSec 30
        Write-Result 'PASS' "Remote APK link reachable: $DownloadApkUrl (HTTP $($response.StatusCode))"
    } catch {
        Write-Result 'FAIL' "Remote APK link is not reachable: $DownloadApkUrl. $($_.Exception.Message)"
    }
}

function Get-AdbDevices {
    if (-not (Test-Path -LiteralPath $AdbPath)) {
        Write-Result 'WARN' "ADB not found at $AdbPath"
        return @()
    }
    $result = Invoke-Captured $AdbPath @('devices', '-l')
    if ($result.ExitCode -ne 0) {
        Write-Result 'WARN' "adb devices failed: $($result.Text)"
        return @()
    }
    $devices = @()
    foreach ($line in $result.Output) {
        if ($line -match '^(\S+)\s+device\s*(.*)$') {
            $devices += [pscustomobject]@{ Serial = $Matches[1]; Detail = $Matches[2] }
        }
    }
    return $devices
}

function Invoke-Adb {
    param([string[]]$Arguments, [switch]$AllowFailure)
    $result = Invoke-Captured $AdbPath $Arguments
    if ($result.ExitCode -ne 0 -and -not $AllowFailure) {
        throw "adb $($Arguments -join ' ') failed: $($result.Text)"
    }
    return $result
}

function Get-AndroidUsers {
    $result = Invoke-Adb @('shell', 'pm', 'list', 'users')
    $users = @()
    foreach ($line in $result.Output) {
        if ($line -match 'UserInfo\{(\d+):([^:}]+)') {
            $users += [pscustomobject]@{ Id = [int]$Matches[1]; Name = $Matches[2]; Raw = $line }
        }
    }
    if (-not ($users | Where-Object { $_.Id -eq 0 })) {
        $users += [pscustomobject]@{ Id = 0; Name = 'Owner'; Raw = 'fallback user 0' }
    }
    return $users | Sort-Object Id -Unique
}

function Test-PackageForUser {
    param([int]$UserId)
    $result = Invoke-Adb @('shell', 'pm', 'list', 'packages', '--user', "$UserId", $PackageName) -AllowFailure
    return ($result.Text -match [regex]::Escape("package:$PackageName"))
}

function Remove-SecondaryPackageInstances {
    param([object[]]$Users)
    foreach ($user in $Users) {
        $present = Test-PackageForUser $user.Id
        Write-Host "      user $($user.Id) $($user.Name): packagePresent=$present"
        if ($present -and $user.Id -ne 0) {
            Write-Result 'WARN' "Package exists in secondary profile user $($user.Id) ($($user.Name)); removing only this package from that profile before smoke."
            Invoke-Adb @('shell', 'am', 'force-stop', '--user', "$($user.Id)", $PackageName) -AllowFailure | Out-Null
            $remove = Invoke-Adb @('shell', 'pm', 'uninstall', '--user', "$($user.Id)", $PackageName) -AllowFailure
            if ($remove.ExitCode -ne 0 -or (Test-PackageForUser $user.Id)) {
                Write-Result 'FAIL' "Could not remove duplicate package from user $($user.Id). Output: $($remove.Text)"
                return $false
            }
            Write-Result 'PASS' "Removed duplicate package from user $($user.Id)."
        }
    }
    return $true
}

function Test-RuntimePermissionsNotGranted {
    $permissions = @(
        'android.permission.CAMERA',
        'android.permission.RECORD_AUDIO',
        'android.permission.POST_NOTIFICATIONS'
    )
    $dump = (Invoke-Adb @('shell', 'dumpsys', 'package', $PackageName)).Text
    foreach ($permission in $permissions) {
        $pattern = [regex]::Escape($permission) + ':\s+granted=true'
        if ($dump -match $pattern) {
            Write-Result 'FAIL' "$permission is runtime-granted after launch; expected not granted."
        } else {
            Write-Result 'PASS' "$permission is not runtime-granted after launch."
        }
    }
}

function Invoke-DeviceSmoke {
    param([string]$ResolvedApk)
    $devices = Get-AdbDevices
    if ($devices.Count -eq 0) {
        if ($RequireDevice) {
            Write-Result 'FAIL' 'No online ADB device found, and -RequireDevice was specified.'
        } else {
            Write-Result 'WARN' 'No online ADB device found; device smoke was skipped. Use -RequireDevice to make this a failure.'
        }
        return
    }

    $device = $devices[0]
    if ($devices.Count -gt 1) {
        Write-Result 'WARN' "Multiple ADB devices detected; using first device $($device.Serial)."
    }
    Write-Result 'PASS' "ADB device detected: $($device.Serial) $($device.Detail)"

    $users = Get-AndroidUsers
    Write-Result 'PASS' "Users/profiles checked: $((($users | ForEach-Object { "$($_.Id):$($_.Name)" }) -join ', '))"
    if (-not (Remove-SecondaryPackageInstances $users)) { return }

    $install = Invoke-Adb @('install', '-r', '--user', '0', $ResolvedApk) -AllowFailure
    if ($install.ExitCode -ne 0) {
        Write-Result 'FAIL' "Install to user 0 failed: $($install.Text)"
        return
    }
    Write-Result 'PASS' "Installed APK to user 0."

    if (-not (Test-PackageForUser 0)) {
        Write-Result 'FAIL' "Package is not present for user 0 after install."
        return
    }
    Write-Result 'PASS' "Package is present for user 0 after install."

    Invoke-Adb @('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP') -AllowFailure | Out-Null
    Invoke-Adb @('shell', 'wm', 'dismiss-keyguard') -AllowFailure | Out-Null
    Invoke-Adb @('shell', 'cmd', 'statusbar', 'collapse') -AllowFailure | Out-Null

    $component = "$PackageName/$ActivityName"
    $launch = Invoke-Adb @('shell', 'am', 'start', '-W', '--user', '0', '-n', $component) -AllowFailure
    if ($launch.ExitCode -ne 0 -or $launch.Text -notmatch 'Status:\s+ok') {
        Write-Result 'FAIL' "Explicit activity launch failed: $($launch.Text)"
        return
    }
    Write-Result 'PASS' "Explicit activity launch succeeded: $component"

    Start-Sleep -Seconds 2
    $focus = (Invoke-Adb @('shell', 'dumpsys', 'window')).Output | Where-Object { $_ -match 'mCurrentFocus|mFocusedApp' }
    $focusText = ($focus -join "`n")
    Write-Host "      focus: $focusText"
    if ($focusText -match 'ResolverActivity') {
        Write-Result 'FAIL' 'Focused window is ResolverActivity; duplicate/chooser state must be fixed before accepting smoke.'
    } elseif ($focusText -match [regex]::Escape($PackageName)) {
        Write-Result 'PASS' 'Focused window belongs to the native app, not ResolverActivity.'
    } else {
        Write-Result 'FAIL' "Focused window does not show $PackageName."
    }

    Test-RuntimePermissionsNotGranted

    New-Item -ItemType Directory -Force -Path $ArtifactsDir | Out-Null
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $remoteShot = '/sdcard/native-smoke.png'
    $localShot = Join-Path $ArtifactsDir "native-smoke-$timestamp.png"
    Invoke-Adb @('shell', 'screencap', '-p', $remoteShot) -AllowFailure | Out-Null
    $pull = Invoke-Adb @('pull', $remoteShot, $localShot) -AllowFailure
    Invoke-Adb @('shell', 'rm', $remoteShot) -AllowFailure | Out-Null
    if ($pull.ExitCode -eq 0 -and (Test-Path -LiteralPath $localShot)) {
        Write-Result 'PASS' "Screenshot saved: $((Resolve-Path -LiteralPath $localShot).Path)"
    } else {
        Write-Result 'FAIL' "Screenshot pull failed: $($pull.Text)"
    }
}

Write-Host '== App smoke / native Android backtest =='
$localApk = Test-LocalApk $ApkPath
Test-RemoteDownload
if ($localApk) {
    Invoke-DeviceSmoke $localApk.Path
}

Write-Host "== Summary: FAIL=$script:FailCount WARN=$script:WarnCount =="
if ($script:FailCount -gt 0) {
    exit 1
}
exit 0
