# 双休超市

区块链信誉商城 Android 项目。双休超市只上架双休、不加班公司的产品；我们支持好产品，也支持做出好产品的人按时下班。商品、订单和直播发现走普通服务端数据；店家身份、评价、投诉、治理下架等信誉事件写入私有签名哈希账本，形成“人手一份、不可篡改”的可同步记录。

## 默认部署地址

- 服务根路径：`http://[2402:4e00:c013:8600:5602:3dc2:a2d0:0]/shc-20260520-a1faaf/weekend-marketplace/`
- API 根路径：`http://[2402:4e00:c013:8600:5602:3dc2:a2d0:0]/shc-20260520-a1faaf/weekend-marketplace/api/`
- APK 下载页：`http://[2402:4e00:c013:8600:5602:3dc2:a2d0:0]/shc-20260520-a1faaf/weekend-marketplace/download/`
- APK 文件：`http://[2402:4e00:c013:8600:5602:3dc2:a2d0:0]/shc-20260520-a1faaf/weekend-marketplace/download/two-day-weekend-marketplace.apk`

## 模块

- `server/`：Node 后端、发现服务器、信誉账本、订单、投票下架、直播信令。
- `web/`：移动优先商城前端/PWA，会被 Android WebView 加载。
- `android/`：Android WebView 壳，负责权限、媒体采集、文件选择、图标与 APK。
- `assets/branding/`：商城图标、宣传海报、应用商店宣传图。
- `deploy/`：服务器部署脚本和 systemd/nginx 辅助配置。
- `scripts/`：本地构建、回归测试、资产生成脚本。

## 开源与安全

本项目以 MIT License 开源。仓库只应包含源码、配置模板和可复现的资源生成脚本；不要提交 SSH 私钥、`.env`、服务器密钥、SQLite 数据库、APK/AAB 构建产物、截图调试产物或本地 IDE 配置。

部署脚本需要通过 `-KeyPath` 或 `TWDM_SSH_KEY` 指定本机 SSH 私钥路径。私钥只应保存在本机或安全密钥管理系统中，不应进入 Git 历史。

## 本地目标

1. `server` 提供可持久化 API，并能验证信誉账本 hash 链。
2. `web` 在后端在线/离线 mock 两种状态下均可演示商城流程。
3. `android` 能打出 APK，并默认连接发现服务器。
4. 回归测试覆盖：店家唯一性、账本不可篡改、商品上架可见、订单创建、投票下架、直播发现、下载页、Web 构建、Android 构建。

## 验证与本地产物

```powershell
pwsh -NoProfile -File scripts\regression.ps1
```

运行回归后会在本机生成以下产物，它们会被 `.gitignore` 排除，不进入开源仓库：

- APK：`android/app/build/outputs/apk/debug/app-debug.apk`
- 下载目录 APK：`server/public/download/two-day-weekend-marketplace.apk`
- 图标：`assets/branding/icon-1024.png`
- 宣传海报：`assets/branding/poster-1080x1920.png`
- 应用商店宣传图：`assets/branding/feature-1024x500.png`

## 部署状态

部署脚本：`pwsh -NoProfile -File deploy\deploy.ps1`

当前服务器使用 Caddy 承载已有 `/shc-20260520-a1faaf/` 应用，因此商城部署在独立子路径 `/shc-20260520-a1faaf/weekend-marketplace/`，避免覆盖原有应用。
