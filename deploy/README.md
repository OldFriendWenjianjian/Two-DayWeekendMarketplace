# Deployment

Default target:

- user: `ubuntu`
- host: `2402:4e00:c013:8600:5602:3dc2:a2d0:0`
- key: pass your local private key with `-KeyPath` or `TWDM_SSH_KEY`
- remote root: `/opt/two-day-weekend-marketplace`
- base path: `/shc-20260520-a1faaf/weekend-marketplace`

Run from repository root:

```powershell
pwsh -NoProfile -File deploy/deploy.ps1 -KeyPath C:\path\to\your-private-key.pem
```

The script builds local assets, uploads the server, web app, branding assets, and APK if present, then installs/restarts the systemd service.

Do not commit SSH keys, `.env` files, generated databases, or APK artifacts.

If nginx is used instead of Caddy, add a location similar to:

```nginx
location /shc-20260520-a1faaf/weekend-marketplace/ {
    proxy_pass http://127.0.0.1:8787/shc-20260520-a1faaf/weekend-marketplace/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```
