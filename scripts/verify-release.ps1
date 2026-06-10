param(
    [string]$BaseUrl = 'http://[2402:4e00:c013:8600:5602:3dc2:a2d0:0]/shc-20260520-a1faaf/weekend-marketplace/',
    [string]$ApkPath = 'server\public\download\two-day-weekend-marketplace.apk',
    [string]$ExpectedPackage = 'com.twodayweekend.marketplace.nativeapp',
    [string]$ExpectedLabel = '双休超市',
    [int]$ExpectedVersionCode = 4,
    [string]$ExpectedVersionName = '0.2.2-native-alpha'
)

$ErrorActionPreference = 'Stop'

function Resolve-Aapt {
    $androidHome = $env:ANDROID_HOME
    if (-not $androidHome) {
        $androidHome = 'C:\Users\a1258\AppData\Local\Android\Sdk'
    }
    $tool = Get-ChildItem -LiteralPath (Join-Path $androidHome 'build-tools') -Recurse -Filter 'aapt.exe' -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending |
        Select-Object -First 1
    if (-not $tool) {
        throw "aapt.exe not found under $androidHome"
    }
    return $tool.FullName
}

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) {
        throw $Message
    }
}

$base = $BaseUrl.TrimEnd('/') + '/'
$api = $base + 'api/'

Write-Host "Checking health: $($base)health"
$health = Invoke-RestMethod -Uri ($base + 'health') -TimeoutSec 30
Assert-True $health.ok 'Health endpoint did not return ok=true.'
Assert-True $health.ledger.ok 'Ledger verification is not ok.'

Write-Host "Checking download metadata: $($api)download"
$download = Invoke-RestMethod -Uri ($api + 'download') -TimeoutSec 30
Assert-True ($download.packageName -eq $ExpectedPackage) "Package mismatch from API: $($download.packageName)"
Assert-True ([int]$download.versionCode -eq $ExpectedVersionCode) "VersionCode mismatch from API: $($download.versionCode)"
Assert-True ($download.versionName -eq $ExpectedVersionName) "VersionName mismatch from API: $($download.versionName)"
Assert-True ($download.sha256 -match '^[a-f0-9]{64}$') "Invalid SHA256 from API: $($download.sha256)"

Write-Host "Checking local APK identity: $ApkPath"
$resolvedApk = Resolve-Path -LiteralPath $ApkPath
$localHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $resolvedApk).Hash.ToLowerInvariant()
Assert-True ($localHash -eq $download.sha256.ToLowerInvariant()) "Local APK hash does not match API metadata."

$aapt = Resolve-Aapt
$badging = & $aapt dump badging $resolvedApk
if ($LASTEXITCODE -ne 0) {
    throw "aapt failed for $resolvedApk"
}
Assert-True ($badging | Select-String -SimpleMatch "package: name='$ExpectedPackage'" -Quiet) "APK package does not match $ExpectedPackage."
Assert-True ($badging | Select-String -SimpleMatch "versionCode='$ExpectedVersionCode'" -Quiet) "APK versionCode does not match $ExpectedVersionCode."
Assert-True ($badging | Select-String -SimpleMatch "versionName='$ExpectedVersionName'" -Quiet) "APK versionName does not match $ExpectedVersionName."
Assert-True ($badging | Select-String -SimpleMatch "application-label:'$ExpectedLabel'" -Quiet) "APK label does not match $ExpectedLabel."

Write-Host 'Checking remote APK bytes and SHA256.'
$remoteApk = Join-Path $env:TEMP 'two-day-weekend-marketplace-release-check.apk'
Invoke-WebRequest -Uri $download.absoluteDownloadUrl -OutFile $remoteApk -UseBasicParsing -TimeoutSec 120
$remoteHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $remoteApk).Hash.ToLowerInvariant()
Assert-True ($remoteHash -eq $download.sha256.ToLowerInvariant()) 'Remote APK hash does not match API metadata.'

Write-Host 'Checking unsigned critical action rejection.'
$probeBody = @{
    sellerId = 'missing-seller'
    title = 'unsigned release probe'
    description = 'release verification probe'
    category = 'probe'
    priceCents = 1
    contact = 'probe'
    images = @()
    clientActionId = 'probe_' + [guid]::NewGuid().ToString('N')
} | ConvertTo-Json -Depth 6
$probe = Invoke-WebRequest -SkipHttpErrorCheck -Uri ($api + 'products') -Method Post -Body $probeBody -ContentType 'application/json' -UseBasicParsing -TimeoutSec 30
Assert-True ($probe.StatusCode -eq 401) "Unsigned critical action was not rejected with 401. Got $($probe.StatusCode)."
Assert-True ($probe.Content -match 'actionCredential is required') "Unexpected unsigned rejection body: $($probe.Content)"

[pscustomobject]@{
    ok = $true
    baseUrl = $base
    versionCode = $download.versionCode
    versionName = $download.versionName
    sha256 = $download.sha256
    ledgerEvents = $health.ledger.eventCount
    packageName = $download.packageName
    apkUrl = $download.absoluteDownloadUrl
} | ConvertTo-Json -Depth 4
