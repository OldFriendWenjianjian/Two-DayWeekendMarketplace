# 双休超市签名动作凭证契约

版本：`signed-action-credential-v1`

本文定义原生客户端与服务端之间的关键动作强校验契约。目标是继续推进“服务端强校验 + 签名凭证 + 责任成本”，避免前端字段被篡改后直接影响治理结果。

## 1. 设计目标

- 客户端提交关键动作时必须携带本机签名凭证。
- 服务端必须重新计算交易锚、责任锚和治理权重。
- 客户端自称的 `hasTradeAnchor`、`stakeAmount`、`governanceWeight` 不能作为服务端依据。
- 网络失败时客户端只能显示“待同步”，不能显示“服务器成功”。
- 0 权重反馈可以留痕，但不得影响核心信誉、下架阈值或认证等级。

## 2. 动作状态

| 状态 | 来源 | 含义 |
| --- | --- | --- |
| `local_draft` | 客户端 | 用户正在编辑，尚未签名 |
| `signed_local` | 客户端 | 已取得服务端 challenge 并由本机私钥签名，准备提交 |
| `pending_sync` | 客户端 | 未获得服务器确认，保留未签名草稿；重试时重新获取 challenge 并重新签名 |
| `submitted` | 服务端 | 服务端已收到请求，正在处理 |
| `server_confirmed` | 服务端 | 服务端返回 2xx，动作已记录 |
| `recorded_zero_weight` | 服务端 | 已留痕，但无治理权重 |
| `governance_queue` | 服务端 | 有权重，进入治理队列 |
| `credential_rejected` | 服务端 | 签名、nonce、bodyHash、key 状态或锚点校验失败 |

客户端 UI 必须直接显示这些状态，不要把 `pending_sync` 或 `local_draft` 文案写成“成功”。

## 3. 客户端动作凭证

请求体中统一携带：

```json
{
  "actionCredential": {
    "version": 1,
    "algorithm": "ES256",
    "actorKey": "actor_abc",
    "keyId": "tdwm_native_actor_v1",
    "clientActionId": "local_abc",
    "actionType": "removal_vote",
    "targetSellerId": "seller_001",
    "targetProductId": "prod_001",
    "orderId": "ord_001",
    "stakeId": "stake_001",
    "bodyHash": "sha256(canonical request body without actionCredential)",
    "challengeId": "chal_001",
    "nonce": "server nonce",
    "createdAt": "2026-06-08T10:00:00.000Z",
    "signature": "base64(signature)",
    "publicKey": "base64(public key)"
  }
}
```

说明：

- 原生客户端提交前应先调用 `/api/action-challenges` 获取服务端一次性 challenge，再把 `challengeId` 和 `nonce` 纳入签名。
- 私有服务端保留 `client-local-v1` 兼容路径；生产可开启 `REQUIRE_SERVER_CHALLENGE=true` 强制拒绝客户端本地 nonce。
- `clientActionId` 是客户端动作幂等键，服务端应按 `actorKey + clientActionId` 去重。
- `bodyHash` 必须覆盖业务请求字段，不覆盖 `signature` 自身。
- `actorKey` 必须绑定已注册公钥，不能只是客户端随便传的字符串。
- `publicKey` 可用于首次注册或调试，服务端正式校验应使用已登记 key。

## 4. 推荐新增 API

### `POST /api/actors/keys`

注册普通用户或商户的客户端公钥。

```json
{
  "actorKey": "actor_abc",
  "keyId": "tdwm_native_actor_v1",
  "algorithm": "ES256",
  "publicKey": "base64",
  "deviceIdHash": "optional hash"
}
```

### `POST /api/action-challenges`

服务端下发一次性 challenge。

```json
{
  "actorKey": "actor_abc",
  "actionType": "removal_vote",
  "targetSellerId": "seller_001",
  "targetProductId": "prod_001"
}
```

返回：

```json
{
  "challengeId": "chal_001",
  "nonce": "random",
  "expiresAt": "2026-06-08T10:05:00.000Z",
  "canonicalVersion": "canonical-json-v1"
}
```

### `POST /api/responsibility-stakes`

创建责任押注，不接受客户端自称 `stakeAmount` 作为有效权重。

```json
{
  "actorKey": "actor_abc",
  "targetSellerId": "seller_001",
  "targetProductId": "prod_001",
  "actionType": "removal_vote",
  "amount": 180,
  "actionCredential": {}
}
```

返回：

```json
{
  "stakeId": "stake_001",
  "status": "locked",
  "lockedUntil": "2026-07-08T10:00:00.000Z"
}
```

### `POST /api/witness/statements`

见证人提交签名证言，服务端返回可引用的 `witnessStatementId`。

## 5. 服务端强制校验

服务端处理评价、投诉、下架申请、上架、直播登记等关键动作时，应执行：

1. 校验 `actionCredential` schema。
2. 查 actor 公钥，验证签名。
3. 校验 challenge/nonce 由服务端签发、未过期、未使用，并与动作目标字段一致。
4. 按 `actorKey + clientActionId` 做幂等检查；重复请求只能返回原结果，不能重复记账或重复计权。
5. 重新计算 canonical body hash。
6. 检查 actionType 与 endpoint 是否匹配。
7. 重新计算交易锚。
8. 重新计算责任押注锚。
9. 重新校验见证人签名、去重和独立性。
10. 写入最终 consensus 结果。
11. 返回明确状态：`recorded_zero_weight`、`governance_queue`、`credential_rejected` 等。

## 6. 原生 App 当前适配

`android-native/` 已按本契约生成 `actionCredential`。关键动作会先请求服务端一次性 challenge，再由 Android Keystore 私钥签名；如果 challenge 获取失败，客户端只把未签名草稿写入 SQLite `pending_actions`，重试时重新获取 challenge 并重新签名。

当前兼容策略：

- 私有服务端可开启 `REQUIRE_ACTION_CREDENTIAL=true` 强制关键动作携带签名凭证。
- 私有服务端可开启 `REQUIRE_SERVER_CHALLENGE=true` 强制关键动作必须携带 `actionCredential`，且只能使用服务端一次性 challenge。
- 服务器未确认时，原生 App 只显示“待同步”，不会显示“已成功”。
- 原生 App 更新下载只接受 `packageName=com.twodayweekend.marketplace.nativeapp` 的服务器元数据；下载并校验 SHA256 后，还会解析 APK 文件自身的实际包名，避免误装旧 WebView APK。

## 7. 后续测试要求

- 正确签名可以通过。
- 错误签名必须拒绝。
- 修改 body 后重放旧 signature 必须拒绝。
- nonce 过期必须拒绝。
- 同一 nonce 重放必须拒绝。
- 同一 `actorKey + clientActionId` 重试只能幂等返回原结果。
- 客户端伪造 `stakeAmount` 不产生责任锚。
- 重复 witness 不产生 quorum。
- 0 权重反馈不影响信誉和下架阈值。
