$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$entry = Join-Path $root 'server_monitor.py'
$icon = Join-Path (Split-Path -Parent (Split-Path -Parent $root)) 'assets\branding\icon.ico'
$args = @(
    '--noconfirm',
    '--onefile',
    '--windowed',
    '--name', '双休超市服务器监测',
    '--distpath', (Join-Path $root 'dist'),
    '--workpath', (Join-Path $root 'build')
)

if (Test-Path $icon) {
    $args += @('--icon', $icon)
}

$args += $entry

pyinstaller @args

Write-Host "Built: $(Join-Path $root 'dist\双休超市服务器监测.exe')"
