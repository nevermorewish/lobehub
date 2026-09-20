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

### 存储与系统设置

管理后台现在使用独立页面路径：`/users`、`/conversations`、`/knowledge`、`/providers`、`/prices`、`/payments`、`/orders`、`/ledger`、`/packs`、`/audit`。新增 `/storage`（存储设置）、`/settings`（系统设置）和 `/deployments`（部署）。支持直接访问、刷新、浏览器前进/后退和未保存编辑保护。

- **存储设置**：S3 Endpoint、内部 Endpoint、Bucket、Region、公开访问 URL、Access Key、Secret Key、路径风格、ACL 和预览链接有效期。凭据加密保存，管理接口不回显；编辑时留空保留原凭据。更换存储桶不会迁移旧文件。
- **系统设置**：站点 URL (`APP_URL`)、内部站点 URL、SearXNG URL，以及视觉模型的 Base64 图片选项。`APP_URL` 必须为站点 origin（协议、主机、端口），用于登录回调与分享链接。
- **生效方式**：保存写入 PostgreSQL `admin_settings`，并记录审计。Docker 启动器在启动 Next.js 和初始化认证/S3 客户端前，从受集成令牌保护的 `/internal/v1/settings` 读取配置。保存后执行 `docker compose restart lobe`；多副本部署需重启所有副本。管理后台会显示重启提示。
- **优先级**：后台已保存的分组覆盖同组环境变量；清空可选字段也会清除对应旧环境变量。尚未保存的分组继续使用环境变量。数据库连接、密钥加密根密钥、集成令牌、后台自身的 `ADMIN_PUBLIC_URL` 和容器网络/网关地址仍保留为部署配置。
- **运行边界**：此读取流程由仓库 Docker `startServer.js` 执行；直接运行 `bun run dev` / Next.js 或独立 Hono 服务仍使用该进程的环境变量。启用管理集成的 Docker 部署在配置服务不可用或鉴权失败时停止启动，避免带着旧凭据运行。

**升级现有 Compose 部署**：先备份原来的 `APP_URL`、S3 和搜索配置；执行 `docker compose up -d --build admin`，在后台 `/storage` 和 `/settings` 填入原值并保存，然后执行 `docker compose up -d --build lobe`。新的 Compose 不再硬编码这些值，不能假定旧的 YAML 值会自动迁入数据库。旧 `.env` 中的同名配置在首次后台保存前仍可作为过渡。

**首次部署**：先启动并配置 admin，再启动 lobe。SearXNG 的 Compose 内部地址可填 `http://searxng:8080`，站点内部地址可填 `http://lobe:3210`，站点访问地址填写浏览器实际使用的域名和端口。没有保存任何配置时，后台仍可独立访问。

### 远程部署

`/deployments` 配置 Linux IP、SSH 端口、用户名、密码、主机 SHA256 指纹、公开 GitHub 仓库、分支和服务器绝对目录。可读取指纹，核对服务器身份后保存；密码加密保存，留空保留。修改 IP 或端口会清空原指纹。

服务器需提前安装 Git、Docker 和 Compose v2，并在代码目录内配置 `docker-compose/deploy/.env`。部署按钮需确认目标，随后在服务器执行 clone（首次）或 fetch + fast-forward、Compose 配置检查、`build --pull admin lobe` 和 `up -d --wait`。未提交的代码或分支/仓库不一致会中止操作，不强制覆盖本地文件。只支持公开 GitHub 仓库；私有仓库认证尚未接入。

任务在服务器后台运行，最长 1 小时；日志和退出码位于 `/var/tmp/lobehub-admin-deployment-<id>`。后台重启后会通过 SSH 重新读取任务状态，数据库保存最近任务与配置快照，防止重复部署。日志显示最后 32 KiB。构建失败不执行容器更新；更新过程中失败可能已有部分容器更新，需查看日志处理，没有自动回滚。

### 用户与扣费记录

钱包功能整合到 `/users`：可用/冻结积分、累计消费和模型请求数，调账、资料/角色/封禁编辑、用户流水、订单、退出登录和删除。旧 `/wallets` 地址重定向到 `/users`。删除操作会永久封禁、撤销会话与 API Key、移出用户列表，保留用户身份关联和不可变财务记录；禁止删除最后一个有效管理员。

`/ledger` 支持邮箱/用户/请求/流水/订单、模型、服务商、类型及时间筛选，汇总覆盖全部匹配记录。详情显示输入/输出 Token、请求 ID、历史单价和公式、预扣、最终消费、余额变动、操作人及价格版本。预扣和释放不计为消费；没有保留相关数据的历史记录显示空缺，不用当前价格冒充历史价格。

LobeHub 设置 `ADMIN_SERVICE_URL=http://admin:3211` 和相同的 `ADMIN_INTEGRATION_TOKEN`。未设置服务地址时保持原有行为。

- `/internal/v1/catalog` 提供服务商可用状态与有效模型配置，由 LobeHub `genServerAiProvidersConfig` 消费。
- `/internal/v1/providers/:id` 仅通过内网 Bearer 认证提供运行时凭据，由 `initModelRuntimeFromDB` 消费。
- 启用管理后台集成后，前端目录只显示后台已启用、凭据已配置且存在有效模型价格的模型；内置默认模型和旧的用户模型记录不会补入目录。调用使用后台凭据与后台地址，不向浏览器下发密钥。未启用集成的部署保留原有用户配置行为。
- 新增服务商由后台生成递增数字 ID，默认启用（需先填写有效凭据，Ollama 除外）。已有字符串 ID 保留，避免破坏价格关联。
- `/prices` 列表页提供「拉取模型 / 批量添加价格」：选择服务商并拉取候选，搜索、勾选多个模型，应用统一价格或逐项修改类型及价格后批量添加。每批最多 200 个；已有未归档价格（含草稿）自动跳过，不覆盖原价格，整批校验及保存使用事务，重试不会重复添加。拉取和取消均不保存；单条价格编辑只负责手动配置。
- 后台使用已保存的密钥请求上游，支持 OpenAI 兼容、Anthropic、Google 和 Ollama 列表；Azure/Bedrock 暂需手填模型 ID。上游列表只提供模型候选，不提供可靠的计费/能力配置；添加前需核对类型、能力和价格，保存启用后才对前端发布。
- OpenAI 兼容服务商填写站点根地址时使用 `/v1` API 路径；已填写自定义路径的地址保持不变。模型目录读取不调用上游列表接口，错误凭据仅在后台拉取或实际调用时暴露为明确错误。

能力边界：钱包、套餐、订单和流水管理依赖 LobeHub 商业计费表及相应服务，需先应用主应用数据库迁移；后台不会替代主应用的调用扣费、下单或收款回调。自定义及数字服务商 ID 自动进入全局目录，无需用户再添加同名服务商。修改目录后刷新主应用即可读取最新配置。

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

设置、部署、用户整合及消费明细本轮验收：https://app.lobehub.com/acceptance/df7129ee-42ca-4d62-b648-b2d8a738481a 。7 项通过；“下月消费套餐”因生效/续费规则未明确而未实施。验证使用隔离数据库、真实 SSH/Git 和两个 Docker 样例服务，未执行完整主应用生产部署。

此前后台基础功能验收：https://app.lobehub.com/acceptance/e6cf8379-410a-47ab-b153-dd1daf379d14 。以下为此前基础功能验证范围，不能替代本轮新增功能记录。

- Go 编译、密码/密钥测试和 PostgreSQL 集成测试通过。
- 独立前端 TypeScript、修改文件 ESLint 和 Docker 多阶段构建通过。Docker 构建会先检查前端类型。
- LobeHub 对接测试 4 项通过，涵盖未启用集成、用户配置隔离、禁用/故障处理与目录去密钥。
- 实际 HTTP 验证覆盖身份认证、密钥隔离、资料持久化、旧版本冲突、跨库访问拦截、消息与文件/文档/切片分页；浏览器覆盖七个页面、中英双语、深浅主题、窄屏和网络失败恢复。
- Go 配置接口 → LobeHub 配置消费者 → 现有 OpenAI 运行时 → 本地协议测试服务已跑通。没有进行外部模型付费调用、真实支付交易或生产库部署，也未完整验收 LobeHub 登录后的聊天界面。
- 全仓类型检查仍受既有的桌面/主仓库 React 与 antd 依赖类型冲突影响；新增管理前端和本次修改路径没有类型诊断。`bun run check` 在当前 Windows 环境中无法启动扩展名缺失的 `.bin` 工具，已直接执行 ESLint 与限定 Vitest 文件作为等价检查。
