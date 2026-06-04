# 双休超市移动端 Web/PWA

这是写在 `web/` 下的移动端商城前端，可由 Android WebView 壳加载，也可由服务器静态托管。

## 功能覆盖

- 发现首页、分类、搜索、商品列表、商品详情、购物车、订单、个人中心
- 卖家入驻、卖家中心、上架商品表单、店家主页
- 评价、投诉、社区投票下架
- 店家 ID 全局唯一展示；投诉、评价、治理下架、店家登记等信誉事件以不可篡改账本事件展示
- 商户直播登记、直播广场、商户页直播入口、WebRTC 观众端 SDP Offer 生成
- 后端不可用时自动 fallback 到 mock 数据
- PWA manifest 与 service worker 基础离线缓存

## API 基路径

默认 API：

```text
http://[2402:4e00:c013:8600:5602:3dc2:a2d0:0]/shc-20260520-a1faaf/weekend-marketplace/api
```

本地开发 API：

```text
http://localhost:8787/shc-20260520-a1faaf/weekend-marketplace/api
```

配置方式：

- 运行时设置 `window.__MARKETPLACE_API_BASE__`
- 构建/开发时设置 `VITE_API_BASE`
- App 内「API 设置」页面保存到 `localStorage`
- 当页面由 `/shc-20260520-a1faaf/weekend-marketplace/` 同源托管时，默认使用当前 origin 下的 `/shc-20260520-a1faaf/weekend-marketplace/api`

当前前端会请求：

- `GET /marketplace`
- `PUT /live/sessions/{sellerId}`
- `POST /products/{productId}/reports`
- `POST /sellers/{sellerId}/complaints`
- `POST /orders`

当请求失败或超时时，界面会继续使用 mock/fallback 数据演示主要流程。

## 运行

```powershell
cd web
npm install
npm run dev
```

打开 Vite 输出的本地地址，默认通常是：

```text
http://localhost:5173
```

## 验证

```powershell
cd web
npm test
npm run build
```

## 静态部署

```powershell
cd web
npm run build
```

将 `web/dist/` 发布到 `/shc-20260520-a1faaf/weekend-marketplace/` 基路径即可。Android WebView 壳默认加载服务器 URL，也带有极简本地 fallback 页。
