# 双休超市原生版

这是新的原生 Android 项目，不再依赖 WebView 作为主要商城体验。旧 `android/` 目录仍保留为 WebView 壳兼容版本；本目录用于推进原生拍照、直播、通知、下载更新、离线队列和签名动作凭证。

## 目标

原生版优先解决三个问题：

- 关键动作必须明确区分 `服务器确认成功`、`本地待同步`、`本地演示/草稿`。
- 用户关键行为必须先由本机密钥签名，形成 `actionCredential`，再提交服务端。
- 拍照、直播、通知、安装更新等权限只在对应功能触发时申请。

## 当前功能

- 原生首页：拉取服务器商品；服务器不可达时不显示假商品为远端商品。
- 原生上架：拍照上传入口、商品草稿、签名提交。
- 联系下单：生成签名动作并提交订单联系请求。
- 商品举报：生成签名治理动作，携带 `actionCredential`。
- 直播入口：按需申请摄像头/麦克风权限，登记直播发现信息。
- 待同步队列：网络失败或服务器未确认时写入 SQLite，用户可手动重试。
- 下载更新：拉取服务器下载信息，校验 SHA256 后调用系统安装器。
- 后台通知：只在用户点击开启同步通知时申请权限。

## 状态模型

原生版禁止把本地演示当成服务器成功。

| 状态 | 含义 | 用户文案 |
| --- | --- | --- |
| `server_confirmed` | 服务器返回 2xx，动作已确认 | 服务器已确认 |
| `pending_sync` | 未获得服务器确认，保存未签名草稿；重试时重新取 challenge 并重新签名 | 待同步 |
| `credential_rejected` | 服务器拒绝或本地队列解析失败 | 凭证/请求被拒绝 |
| `local_draft` | 用户正在编辑，尚未签名提交 | 草稿 |

## 签名凭证

客户端使用 Android Keystore 生成本机密钥，派生 `actorKey`。每个关键动作会携带：

- `actorKey`
- `clientActionId`
- `actionType`
- `targetSellerId`
- `targetProductId`
- `orderId`
- `stakeId`
- `bodyHash`
- `challengeId`
- `nonce`
- `createdAt`
- `signature`
- `publicKey`

`clientActionId` 是客户端本地动作幂等键，服务端按 `actorKey + clientActionId` 去重，避免离线队列重试时把同一个动作重复计入治理或订单记录。

当前版本使用 Android Keystore 支持稳定的 `SHA256withECDSA`。关键动作提交前会调用 `/api/action-challenges` 获取服务端一次性 challenge；网络失败时不会保存过期签名，而是保存未签名草稿，用户重试同步时重新获取 challenge 并重新签名。

## Alpha 限制

- 当前原生客户端已对接服务端 `actionCredential` 校验契约；服务端部署可通过环境变量逐步强制启用签名凭证和一次性 challenge。
- 当前直播是原生权限申请、开播发现登记和 P2P 信令元数据登记，不是完整 WebRTC/SFU 多人直播引擎。
- 当前更新只接受服务器明确标注 `packageName=com.twodayweekend.marketplace.nativeapp` 且提供 SHA256 的 APK；下载后还会解析 APK 实际包名，避免误装旧 WebView 包或未校验安装。
- 当前图片上传使用拍照结果生成 `data:image/jpeg;base64,...` 放入上架请求；生产环境建议升级为对象存储或分片上传。

## 构建

推荐从仓库根目录运行回归脚本：

```powershell
cd C:\Users\a1258\Documents\Two-DayWeekendMarketplace
pwsh -NoProfile -File scripts\regression.ps1
```

只构建原生版时：

```powershell
cd C:\Users\a1258\Documents\Two-DayWeekendMarketplace\android-native
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME='C:\Users\a1258\AppData\Local\Android\Sdk'
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
$env:TDWM_GRADLE='C:\Users\a1258\.gradle\wrapper\dists\gradle-8.7-bin\bhs2wmbdwecv87pi65oeuq5iu\gradle-8.7\bin\gradle.bat'
& $env:TDWM_GRADLE --no-daemon :app:assembleDebug
```

如果本机已经安装了 `gradle`，也可以直接执行 `gradle --no-daemon :app:assembleDebug`。后续补上可联网生成的 Gradle wrapper 后，应优先使用项目自带 `gradlew.bat`。

输出 APK：

```text
android-native/app/build/outputs/apk/debug/app-debug.apk
```

## 和旧版关系

- `android/`：旧 WebView 壳，包名 `com.twodayweekend.marketplace`。
- `android-native/`：新原生版，包名 `com.twodayweekend.marketplace.nativeapp`。

两个包名不同，方便并行验证；正式替换时再决定是否迁移回原包名。
