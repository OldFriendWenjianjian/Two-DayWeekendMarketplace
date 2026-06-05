# 双休超市

区块链信誉商城 Android 项目。双休超市只上架双休、不加班公司的产品；我们支持好产品，也支持做出好产品的人按时下班。商品、订单和直播发现走普通服务端数据；店家身份、评价、投诉、治理下架等信誉事件写入私有签名哈希账本，形成“人手一份、不可篡改”的可同步记录。

信誉治理采用“双锚信誉共识”：账号数量和账号年龄不产生治理权，只有真实交易锚或责任押注锚才能影响核心信誉。一万个空号仍然是 0 权重；评价别人，也会写入自己的履历。详见 [双休超市公平治理白皮书](docs/fair-governance-whitepaper.md) 和 [双锚信誉共识手册](docs/dual-anchor-consensus.md)。

## 商城规则

双休超市的基本规则是：平台优先展示双休、不加班公司的产品，鼓励用户监督商品来源，也保护商户不被空号围攻。

- 商品数据是普通商城数据，可以更新、补图、下架和重新编辑，不进入不可篡改账本。
- 店家 ID 是个人品牌标识，全局唯一，不可重复创建，不可删除；店家身份登记会进入信誉账本。
- 商品交易先采用买卖双方联系和订单记录，不做链上支付、托管或公开链结算。
- 评价、投诉、商品治理下架等信誉事件会同时写入发起人履历和目标对象履历。
- 普通留言和 0 权重反馈可以被看见、可追溯，但不会直接影响商户核心信誉。
- 越严肃的指控，越需要更强的责任来源：已完成订单、责任押注或见证人背书。
- 被判定为恶意的投诉、刷评、围攻会反噬发起人，降低其后续治理权。
- 商户开播时只把直播房间、商户标识和连接元数据登记到发现服务器；媒体流优先走 P2P 直连。

## 公开协议

双休超市把“可变业务数据”和“不可篡改信誉数据”分开处理。

业务数据协议：

- `seller`：店家资料、品牌名、联系方式、营业理念、双休不加班承诺。
- `product`：商品标题、价格、分类、详情、图片、联系方式、上下架状态。
- `order`：买家联系请求、商品 ID、商户 ID、留言、订单联系状态。
- `live_session`：商户直播房间、在线状态、P2P 连接候选信息、直播标题等短期数据。
- `signaling_message`：直播直连需要的短期信令消息，只用于建立连接，不承载直播媒体流。

信誉账本协议：

- 账本只记录店家身份、评价、投诉、治理动作、强制下架、共识参数变更等信誉事件。
- 商品详情、商品图片、普通库存、普通浏览统计不写入账本。
- 客户端可按 `afterId` 增量同步账本事件，保留本地副本，并校验哈希链是否连续。
- 治理算法版本必须写入事件 payload，例如 `dual-anchor-v1`，方便未来升级后回溯解释。
- 任何共识升级都应以“新版本规则 + 生效高度/时间 + 迁移说明”的方式公开，旧事件按旧规则解释，新事件按新规则解释。

## 账本校验

信誉账本采用追加式哈希链。每一条事件都引用上一条事件的哈希，任何中间记录被修改、删除或重排，都会导致后续校验失败。

事件字段：

- `id`：递增高度，从 1 开始。
- `prevHash`：上一条事件的 `eventHash`；创世事件使用 64 个 `0`。
- `eventType`：事件类型，例如店家登记、评价、投诉、下架投票。
- `actorId`：发起人 ID，可以是买家、商户、管理员或见证人。
- `subjectSellerId`：被影响的商户 ID。
- `payload`：事件内容，必须使用稳定字段名和规范 JSON。
- `createdAt`：事件创建时间。
- `eventHash`：事件规范化后的 SHA-256 哈希。
- `signature`：平台私有签名，用来证明事件由授权账本节点写入。

校验步骤：

1. 按 `id` 从小到大读取账本事件。
2. 第一条事件要求 `prevHash` 等于创世哈希，后续事件要求 `prevHash` 等于上一条 `eventHash`。
3. 对 `id`、`prevHash`、`eventType`、`actorId`、`subjectSellerId`、`payload`、`createdAt` 做规范 JSON 序列化。
4. 计算 SHA-256，确认结果等于事件内的 `eventHash`。
5. 使用当前公开的验证方式或可信验证节点确认 `signature` 有效。
6. 如果任意一步失败，客户端必须标记账本为异常，并展示失败高度和原因。

校验结果至少包含：

- `ok`：账本是否完整可信。
- `eventCount`：已校验事件数量。
- `headHash`：当前账本头哈希。
- `failures`：失败事件列表和原因。

## 治理算法

当前治理算法版本是 `dual-anchor-v1`。它的核心目标是抵抗批量注册、养号攻击和情绪化围攻。

权重来源：

- 普通留言：权重 `0`，写入双方履历，不进入核心信誉。
- 完成订单评价：存在匹配已完成订单时形成真实交易锚，基础权重 `1`。
- 责任押注投诉：押注达到最低责任阈值时形成责任锚，权重按押注强度折算，并设置上限。
- 见证人背书：有效见证人数量达到 quorum 时形成责任锚，重复见证签名只算一次，并设置上限。
- 商品下架申请：真实交易锚和责任锚可以叠加，达到治理阈值后进入下架队列。

默认计算逻辑：

```text
tradeAnchor = actor.completedOrders contains action.orderId
stakeAnchor = max(action.stake, actor.reputationStake) >= minimumResponsibilityStake
witnessAnchor = unique(action.witnessSignatures).count >= witnessQuorum
responsibilityWeight = max(stakeWeight, witnessWeight)
penalty = max(0, 1 - maliciousActionCount * maliciousPenaltyPerRecord)

comment.weight = 0
orderReview.weight = tradeAnchor ? 1 * penalty : 0
complaint.weight = ((tradeAnchor ? 1 : 0) + responsibilityWeight) * penalty
removalVote.weight = ((tradeAnchor ? 1 : 0) + responsibilityWeight) * penalty

if maliciousActionCount >= maliciousZeroAt:
  weight = 0
```

治理原则：

- 账号数量不产生权重，一万个空号仍然是 `0`。
- 账号年龄不产生权重，提前养号几年也不会自动获得治理权。
- 没有交易锚、押注锚或见证 quorum 的投诉，只作为普通反馈留痕。
- 评价别人也会记录在自己的履历里，恶意行为会降低未来治理权。
- 见证人不是免费按钮，见证行为同样进入见证人履历。
- 共识阈值可以升级，但升级必须公开版本、原因、生效范围和回溯解释方式。

## 默认部署地址

- 服务根路径：`http://[2402:4e00:c013:8600:5602:3dc2:a2d0:0]/shc-20260520-a1faaf/weekend-marketplace/`
- API 根路径：`http://[2402:4e00:c013:8600:5602:3dc2:a2d0:0]/shc-20260520-a1faaf/weekend-marketplace/api/`
- APK 下载页：`http://[2402:4e00:c013:8600:5602:3dc2:a2d0:0]/shc-20260520-a1faaf/weekend-marketplace/download/`
- APK 文件：`http://[2402:4e00:c013:8600:5602:3dc2:a2d0:0]/shc-20260520-a1faaf/weekend-marketplace/download/two-day-weekend-marketplace.apk`

## 模块

- `server/`：Node 后端、发现服务器、信誉账本、订单、双锚治理下架、直播信令。
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
4. 回归测试覆盖：店家唯一性、账本不可篡改、商品上架可见、订单创建、双锚治理下架、直播发现、下载页、Web 构建、Android 构建。

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
