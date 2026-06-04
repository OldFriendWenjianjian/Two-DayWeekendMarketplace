param(
    [string]$HostAddress = '2402:4e00:c013:8600:5602:3dc2:a2d0:0',
    [string]$User = 'ubuntu',
    [string]$KeyPath = $env:TWDM_SSH_KEY,
    [string]$RemoteRoot = '/opt/two-day-weekend-marketplace',
    [string]$BasePath = '/shc-20260520-a1faaf/weekend-marketplace'
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($KeyPath)) {
    throw 'Provide an SSH private key path with -KeyPath or TWDM_SSH_KEY. Never commit private keys.'
}

function Invoke-Checked {
    param([string]$FilePath, [string[]]$ArgumentList)
    Write-Host ">> $FilePath $($ArgumentList -join ' ')"
    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed: $FilePath"
    }
}

$repo = Resolve-Path (Join-Path $PSScriptRoot '..')
$remote = "$User@[$HostAddress]"
$scpRemote = $remote
$sshArgs = @('-i', $KeyPath, '-o', 'StrictHostKeyChecking=accept-new')

Push-Location $repo
try {
    if (Test-Path 'server/package.json') {
        Invoke-Checked 'npm' @('--prefix', 'server', 'install')
        Invoke-Checked 'npm' @('--prefix', 'server', 'test')
    }
    if (Test-Path 'web/package.json') {
        Invoke-Checked 'npm' @('--prefix', 'web', 'install')
        Invoke-Checked 'npm' @('--prefix', 'web', 'run', 'build')
    }
    if (Test-Path 'scripts/generate_branding.py') {
        Invoke-Checked 'python' @('scripts/generate_branding.py')
    }

    Invoke-Checked 'ssh' ($sshArgs + @($remote, "sudo mkdir -p $RemoteRoot/releases/server $RemoteRoot/releases/web $RemoteRoot/releases/branding $RemoteRoot/data $RemoteRoot/download && sudo chown -R ${User}:${User} $RemoteRoot"))
    Invoke-Checked 'scp' ($sshArgs + @('server/package.json', 'server/package-lock.json', 'server/README.md', "$scpRemote`:$RemoteRoot/releases/server/"))
    Invoke-Checked 'scp' ($sshArgs + @('-r', 'server/src', 'server/scripts', "$scpRemote`:$RemoteRoot/releases/server/"))
    if (Test-Path 'web/dist') {
        Invoke-Checked 'scp' ($sshArgs + @('-r', 'web/dist', "$scpRemote`:$RemoteRoot/releases/web"))
    }
    if (Test-Path 'assets/branding') {
        Invoke-Checked 'scp' ($sshArgs + @('-r', 'assets/branding', "$scpRemote`:$RemoteRoot/releases/branding"))
    }
    if (Test-Path 'android/app/build/outputs/apk/debug/app-debug.apk') {
        Copy-Item -Force 'android/app/build/outputs/apk/debug/app-debug.apk' 'two-day-weekend-marketplace.apk'
        Invoke-Checked 'scp' ($sshArgs + @('two-day-weekend-marketplace.apk', "$scpRemote`:$RemoteRoot/download/two-day-weekend-marketplace.apk"))
    }

    $remoteScript = @"
set -e
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js and npm are required on the Ubuntu server. Install Node.js 22.5+ before deploying." >&2
  exit 1
fi
node -e "const [major, minor] = process.versions.node.split('.').map(Number); if (major < 22 || (major === 22 && minor < 5)) { console.error('Node.js 22.5+ is required, current ' + process.versions.node); process.exit(1); }"
cd $RemoteRoot/releases/server
npm install --omit=dev
cat > $RemoteRoot/two-day-weekend-marketplace.env <<'EOF'
PORT=8787
BASE_PATH=$BasePath
DB_PATH=$RemoteRoot/data/marketplace.sqlite
APK_PATH=$RemoteRoot/download/two-day-weekend-marketplace.apk
WEB_DIR=$RemoteRoot/releases/web/dist
SERVER_URL=http://[$HostAddress]$BasePath/
EOF
if [ -f $RemoteRoot/secrets.env ]; then
  . $RemoteRoot/secrets.env
fi
if [ -z "`$ADMIN_TOKEN" ]; then
  ADMIN_TOKEN="`$(openssl rand -hex 24)"
fi
if [ -z "`$LEDGER_SECRET" ]; then
  LEDGER_SECRET="`$(openssl rand -hex 32)"
fi
cat > $RemoteRoot/secrets.env <<EOF
ADMIN_TOKEN=`$ADMIN_TOKEN
LEDGER_SECRET=`$LEDGER_SECRET
EOF
chmod 600 $RemoteRoot/secrets.env
cat $RemoteRoot/secrets.env >> $RemoteRoot/two-day-weekend-marketplace.env
set -a
. $RemoteRoot/two-day-weekend-marketplace.env
set +a
npm run seed
sudo tee /etc/systemd/system/two-day-weekend-marketplace.service >/dev/null <<'EOF'
[Unit]
Description=双休超市
After=network.target

[Service]
Type=simple
WorkingDirectory=$RemoteRoot/releases/server
EnvironmentFile=$RemoteRoot/two-day-weekend-marketplace.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=3
User=$User

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now two-day-weekend-marketplace
sudo systemctl restart two-day-weekend-marketplace
if command -v caddy >/dev/null 2>&1 && [ -f /etc/caddy/Caddyfile ]; then
  sudo python3 - <<'PY'
from pathlib import Path

base = "$BasePath"
site = "http://[$HostAddress] {"
anchor = "  handle_path /shc-20260520-a1faaf/* {\n"
snippet = f"  handle {base}* {{\n    reverse_proxy 127.0.0.1:8787\n  }}\n"
path = Path("/etc/caddy/Caddyfile")
text = path.read_text()
if snippet not in text:
    if site not in text:
        raise SystemExit(f"Caddy site block not found: {site}")
    if anchor not in text:
        raise SystemExit(f"Caddy anchor not found: {anchor.strip()}")
    text = text.replace(anchor, snippet + anchor, 1)
    path.write_text(text)
PY
  sudo caddy validate --config /etc/caddy/Caddyfile
  sudo systemctl reload caddy
elif command -v nginx >/dev/null 2>&1; then
  sudo tee /etc/nginx/conf.d/two-day-weekend-marketplace.conf >/dev/null <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name _;

    location /shc-20260520-a1faaf/weekend-marketplace/ {
        proxy_pass http://127.0.0.1:8787/shc-20260520-a1faaf/weekend-marketplace/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade `$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host `$host;
        proxy_set_header X-Forwarded-For `$proxy_add_x_forwarded_for;
    }
}
EOF
  sudo nginx -t
  sudo systemctl reload nginx
fi
"@
    $tmp = New-TemporaryFile
    $remoteScriptLf = $remoteScript -replace "`r`n", "`n" -replace "`r", "`n"
    [System.IO.File]::WriteAllText($tmp.FullName, $remoteScriptLf, [System.Text.UTF8Encoding]::new($false))
    Invoke-Checked 'scp' ($sshArgs + @($tmp.FullName, "$scpRemote`:/tmp/tw-market-deploy.sh"))
    Invoke-Checked 'ssh' ($sshArgs + @($remote, 'bash /tmp/tw-market-deploy.sh'))
}
finally {
    Pop-Location
}
