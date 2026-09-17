# LobeHub Go 管理后台

采用 HuanXing-Team 的 Go/Gin + GORM/PostgreSQL、`router → controller → service → model` 分层。React 19 / TypeScript / Rsbuild 前端位于 `web/default`，构建后由 Go embed 打包为单个可执行文件，独立 Docker 服务运行。

管理入口包括用户、会话、知识库、模型服务商、模型价格、支付配置和操作记录。用户、会话、知识库直接使用 LobeHub 原表；后台只迁移 `admin_*` 表，不迁移 LobeHub 表。

## 启动

1. 将 `.env.example` 复制为 `.env`。`DATABASE_URL` 指向 **LobeHub 所在数据库**，不要指向另一套空库。
2. 配置 `ADMIN_PASSWORD`（12–72 字节），使用独立的随机值配置 `ADMIN_ENCRYPTION_KEY`（32 字节 base64）和 `ADMIN_INTEGRATION_TOKEN`（至少 32 字节）。例如分别执行 `openssl rand -base64 32`。
3. `ADMIN_PUBLIC_URL` 必须与浏览器访问的协议、主机及端口完全一致。正式环境使用 HTTPS；默认映射仅监听 `127.0.0.1`，适合放在反向代理后。
4. 在 `admin` 目录执行 `docker compose up -d --build`。

仓库现有的 `docker-compose/deploy/docker-compose.yml` 也已添加独立 `admin` 服务。使用该 Compose 时，在它的 `.env` 中配置同名变量，其中数据库变量为 `ADMIN_DATABASE_URL`。通过 `docker compose up -d --build admin lobe` 构建两端，才能使用本地新增的 LobeHub 对接代码；旧的远程 LobeHub 镜像不会自动拥有新接口。

后台端口默认 `3211`。`ADMIN_USERNAME` 默认为 `admin`。账号只在首次启动创建，修改环境变量不会重置已有管理员密码。加密密钥必须稳定保留，轮换前需要迁移密文。

## 数据与功能

- **用户管理**：搜索、分页、姓名/用户名/邮箱/角色修改、封禁/解封、撤销 Better Auth 与 NextAuth 会话、最后一个有效 LobeHub 管理员保护、更新时间并发校验。
- **会话管理**：只读搜索与筛选 topics；按消息数、时间、Token、费用排序；消息游标分页；正文、推理、工具、附件资料、翻译、搜索、用量及原始结构查看。
- **知识库管理**：个人/工作空间与 RAG 状态筛选；文件/文档/切片和向量覆盖统计；文件任务错误、文档正文/页面/编辑器数据、切片查看；只修改库名称、说明、头像。使用当前 LobeHub 的 `document_chunks` 结构；不返回 embedding 数组。
- **服务商**：平台 API 地址、SDK、启用状态、凭据；AES-256-GCM 加密，按记录绑定认证数据；普通管理接口不返回密钥；留空保留、显式清除。
- **模型价格**：输入/输出每千 Token 整数积分、模型能力与上下文长度、价格版本启用/归档；事务锁与唯一索引保证每个模型只有一条有效价格。
- **支付配置**：支付宝 RSA2、Stripe 配置持久化、密钥状态、沙箱/币种/积分兑换、HTTPS 与 RSA 格式校验。
- **操作记录**：写操作在同一事务中记录审计；会话内容、文档和切片读取也会记录访问。

## LobeHub 对接

LobeHub 设置 `ADMIN_SERVICE_URL=http://admin:3211` 和相同的 `ADMIN_INTEGRATION_TOKEN`。未设置服务地址时保持原有行为。

- `/internal/v1/catalog` 提供服务商可用状态与有效模型配置，由 LobeHub `genServerAiProvidersConfig` 消费。
- `/internal/v1/providers/:id` 仅通过内网 Bearer 认证提供运行时凭据，由 `initModelRuntimeFromDB` 消费。
- 用户自行配置了凭据或 API 地址时使用完整的用户配置；不会将平台密钥拼接到用户提供的地址上。

能力边界：本项目管理价格与支付配置，不提供积分钱包、调用扣费、支付下单或收款回调。保存这些配置不会自动启用资金流程。LobeHub 自动目录接入使用内置服务商 ID（如 `openai`）；自定义 ID 目前需要用户在 LobeHub 中添加同名服务商，不会自动进入全局服务商列表。

## 开发与检查

```powershell
cd admin/web/default
pnpm install --ignore-workspace
bun run typecheck
bun run build
# 前端构建之后，在 admin 目录：
go test ./...
go run .
```

Go 的真实数据库测试使用 `ADMIN_TEST_DATABASE_URL`，每个测试创建并清理随机 schema，不清空应用数据库。未配置该变量时会明确跳过数据库测试。

前端独立安装并锁定依赖，不依赖根目录 pnpm workspace；其双语资源随独立镜像一起构建。开发服务器端口 `5174`，代理 `/api` 到 `3211`；此时将 Go 的 `ADMIN_PUBLIC_URL` 设为前端开发地址。

## 当前验证状态

本地验收记录：https://app.lobehub.com/acceptance/e6cf8379-410a-47ab-b153-dd1daf379d14 。本轮 11 项用例均已提交所需证据，使用隔离样例数据库；验收范围和未验证部分见记录说明。

- Go 编译、密码/密钥测试和 PostgreSQL 集成测试通过。
- 独立前端 TypeScript、修改文件 ESLint 和 Docker 多阶段构建通过。Docker 构建会先检查前端类型。
- LobeHub 对接测试 4 项通过，涵盖未启用集成、用户配置隔离、禁用/故障处理与目录去密钥。
- 实际 HTTP 验证覆盖身份认证、密钥隔离、资料持久化、旧版本冲突、跨库访问拦截、消息与文件/文档/切片分页；浏览器覆盖七个页面、中英双语、深浅主题、窄屏和网络失败恢复。
- Go 配置接口 → LobeHub 配置消费者 → 现有 OpenAI 运行时 → 本地协议测试服务已跑通。没有进行外部模型付费调用、真实支付交易或生产库部署，也未完整验收 LobeHub 登录后的聊天界面。
- 全仓类型检查仍受既有的桌面/主仓库 React 与 antd 依赖类型冲突影响；新增管理前端和本次修改路径没有类型诊断。`bun run check` 在当前 Windows 环境中无法启动扩展名缺失的 `.bin` 工具，已直接执行 ESLint 与限定 Vitest 文件作为等价检查。
