# 双休超市服务器监测工具

本目录是本地 Windows 桌面监测工具，不包含服务器私钥，也不需要把服务端代码公开更新。

## 功能

- 集中保存服务器 IPv6 地址和商城路径。
- 实时检查服务根路径、健康接口、商城数据接口、下载页、APK 下载接口、直播列表接口。
- 统计本地监测期间的请求次数、成功率、平均耗时、失败次数。
- 记录本地看到的 APK 下载探测次数、直播房间数、商品数、店铺数、账本高度。
- 展示“关键转发压力”估算：商城数据请求、下载探测、直播发现、信令轮询。
- 可手动发起一次信令轮询压力探测，不发送直播媒体流。

## 打包

```powershell
pwsh -NoLogo -NoProfile -File tools\server-monitor\build.ps1
```

生成的 EXE：

```text
tools/server-monitor/dist/双休超市服务器监测.exe
```

## 配置

首次启动会自动创建：

```text
tools/server-monitor/config.json
```

默认服务器 IPv6：

```text
2402:4e00:c013:8600:5602:3dc2:a2d0:0
```

如需改服务器，只改 `config.json` 即可。
