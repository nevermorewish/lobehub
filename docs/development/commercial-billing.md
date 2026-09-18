# 自部署积分与支付宝

本实现迁入了 Wedai 的账单账户、钱包、积分账本、订单和价格快照核心，并接入当前 Go 管理后台。当前商品是**一次性积分包**；虽然数据库保留订阅表，尚未实现周期订阅、自动续费或订阅权益。

## 数据与扣费规则

- 金额使用人民币分，积分使用整数；不使用浮点金额。
- 管理后台 `admin_model_prices` 是平台模型价格来源。聊天按输入、输出各自单价合并后向上取整；图片、视频按每个输出的固定积分收费。媒体价格必须匹配模型类型。
- 可用积分与预留积分分开保存。账本 `delta` 表示总余额变化，等于 `availableDelta + reservedDelta`。预扣、释放只是两个余额桶之间转移，因此净变动为零。
- 预扣与用量记录在同一事务创建；钱包行锁、幂等键和预扣结算唯一约束避免并发透支及重复入账。修改同一请求的参数不能复用旧幂等键。
- 聊天响应消费结束后按提供商实际用量结算；取消、错误或没有用量时释放预扣。缺少用量不按估计值扣费，应监控 `usage_missing`。
- 图片、视频在提交前预扣，完成后按冻结价格结算，失败释放；创建任务的数据库事务失败也释放预扣。
- 用户自有模型凭据走 BYOK，不消耗平台积分；其端点不能借用平台的环境 API Key。用户 Vertex 配置必须提供自己的服务账户凭据。
- 积分属于个人账户，工作空间标识只用于归属信息，尚无共享工作空间钱包。

## 支付

主应用通过 `ADMIN_SERVICE_URL` 与 `ADMIN_INTEGRATION_TOKEN` 获取管理后台保存的加密支付宝配置。用户只提交积分包价格 ID，金额、商户、环境和到账积分由服务端冻结。回调路径为 `/api/webhooks/alipay`。

回调验 RSA2 签名，并核对订单金额、应用与收款商户。支付状态、钱包、账本与通知记录在同一事务提交；同一订单的重复通知、不同通知 ID 都不会重复到账。用户浏览器跳转回来不会触发充值，页面查询服务端真实订单状态。

真实接入时需要商户自己的 App ID、卖家 PID、应用私钥、支付宝公钥、可公网访问的 HTTPS 通知地址和返回地址。不要将本地验收用的自签密钥当作支付宝真实沙箱或生产配置。

## 本次本地部署

主应用：`http://localhost:3220`；Go 管理后台：`http://localhost:3212`。主数据库为隔离的 `lobehub-billing-app-db`，主机端口 `55443`。已有其他 Docker 应用保持原状。

本地环境和生成的密码保存在 Git 忽略的 `.temp/billing-local/`，不随源码发布：

- `app.env`、`admin.env`：容器启动配置。
- `credentials.json`：本地数据库、后台管理员与内部通信凭据。
- `seed.ts`：27 个测试账户的夹具来源；`billing1@local.test`、`billing2@local.test` 用于身份隔离验证。
- `provider.mts`：可观测的本地 OpenAI 兼容夹具，端口 `3225`；它不调用真实 AI 提供商。
- `s3/`：S3rver 测试存储，端口 `3226`。`S3_ENDPOINT` 使用本机当前局域网地址，使 Docker 与浏览器都能读取签名 URL；更换网络后需要调整。

容器使用 `lobehub-billing-app:local` 与 `lobehub-billing-admin:local`。验收时用临时 Dockerfile 基于 `node:24-slim` 构建应用，并修正 `/bin/node` 路径；这不是对生产 Dockerfile 的替代建议。完整数据库迁移已执行至 `0161_commercial_billing`。

已启动的容器可用 `docker start lobehub-billing-app-db lobehub-billing-admin lobehub-billing-app` 恢复。测试模型与存储夹具需要单独启动：

```powershell
bun .temp/billing-local/provider.mts
node node_modules/s3rver/bin/s3rver.js -d .temp/billing-local/s3 -a 0.0.0.0 -p 3226 --no-vhost-buckets --configure-bucket billing-fixture -s
```

构建后页面回归探针（Cookie 文件属于测试会话，不应提交或发送给他人）：

```powershell
$env:BILLING_SMOKE_COOKIE_FILE = '.temp/billing-local/user1-cookie.txt'
bun scripts/billing/verify-local.mts
```

## 商业上线前仍需补齐

1. 长期预留与崩溃恢复：目前保留 `settle_pending` 和已测用量供核对，没有自动对账/重试 worker。不能直接清零预留余额；应通过对应预扣的结算或释放账本处理。
2. 支付主动查单、退款、密钥轮换期间旧订单校验与自动补单，尚未实现。
3. 本次计费覆盖共享 runtime 的聊天，以及图片、视频生成路径；`generateObject`、向量、语音与服务端异构代理专用入口尚未全部纳入计费。不要将当前实现描述为所有模型调用都已计费。
4. 本地 RSA 通知和模型夹具验证了应用闭环，不能替代真实支付宝沙箱联调或真实模型提供商验收。
5. 账本只追加由应用代码遵守，没有数据库触发器禁止管理员直接改账。

验收记录位于 `.acceptances/standalone-commercial-billing/20260918-local/`。仓库整体类型检查仍受已有的多份 React 类型冲突影响；不能把局部检查通过描述为全仓类型检查通过。
