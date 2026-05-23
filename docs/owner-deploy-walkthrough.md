# Owner 上云手册（零基础 / 手把手）

写给从零开始切生产的人。每一步说清楚：去哪个网站、点哪个按钮、填什么值、把什么值贴回 Claude。

---

## 我（Claude）和你（Owner）的分工

| 你做 | 我做 |
|---|---|
| 注册账号 / 验邮箱 / 绑信用卡 | 写代码、改 env 文件 |
| 点 DNS 控制台 / 加 DNS 记录 | 跑 preflight 验证、跑 db:push、跑 smoke |
| OAuth 授权（GitHub、Vercel） | 写入你给的 secret 到 `.env.production` |
| 把网站 dashboard 上的 key / URL 复制给我 | 解析报错、修 bug |

**每一步收尾的"打卡"动作**：你把网站给你的几个值贴到对话里（比如 `DATABASE_URL=postgresql://...`），我帮你写入 `.env.production` 并立刻跑 `pnpm exec tsx scripts/preflight-prod.ts` 局部验证。

---

## Step 0 — 准备工作（30 分钟）

### 0.1 域名

如果还没有，去 **Cloudflare** 买一个（推荐，DNS / R2 / 后续 CDN 一站式，2026 年 .com 约 $10/年）：

1. 打开 https://dash.cloudflare.com → Sign up → 邮箱验证
2. 左侧菜单 → **Domain Registration** → **Register Domains** → 搜你想要的域名
3. 选 `.com` 或 `.app` → 加购物车 → 结账（绑信用卡）

**贴给我**：
```
DOMAIN=your-domain.com
```

### 0.2 GitHub 仓库（Vercel 需要从 GitHub 拉代码）

1. 打开 https://github.com → 登录
2. 右上角 **+** → **New repository** → 名字 `sistine-prod`（或随便）→ **Private** → Create
3. 在本地终端跑（替换成你的仓库地址）：
   ```bash
   cd d:/gpt-image2/GPT-Image2-Studio/sistine/sistine-starter-vibe-to-production-main
   git init
   git add .
   git commit -m "initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-name>/sistine-prod.git
   git push -u origin main
   ```
4. 如果 push 卡在认证：GitHub → Settings → Developer settings → Personal access tokens → 生成一个 token，push 时用户名填邮箱、密码填 token

**贴给我**：仓库 URL（我不会改你的 GitHub，只是知道地址好引用）

### 0.3 信用卡

准备一张能国际付费的双币卡（Visa/Master）。后面 Vercel / Cloudflare R2 / Resend / Creem 大概率都会要绑卡（虽然多数有免费额度）。

---

## Step 1 — Neon 数据库（10 分钟，免费 0.5GB）

1. 打开 https://neon.tech → **Sign Up** → 用 GitHub 一键登录最快
2. 进入 dashboard → **Create Project**
   - Project name: `sistine-prod`
   - PostgreSQL version: 16（默认即可）
   - Region: **AWS Asia Pacific (Singapore)** ← 离国内近，延迟低
   - 点 **Create Project**
3. 创建完后页面顶部有 **Connection String**，看起来像：
   ```
   postgresql://neondb_owner:xxx@ep-cool-name-12345.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```
4. 点右边 **Copy** 复制

**贴给我**：
```
DATABASE_URL=postgresql://...（粘贴完整的）
```

→ 我会写入 `.env.production`，然后跑 `pnpm db:push` 让 11 张 `studio_*` 表落库，跑完给你看结果。

---

## Step 2 — Resend 邮件（15 分钟，免费 100 封/天）

1. 打开 https://resend.com → **Sign Up**
2. 左侧 **Domains** → **Add Domain** → 输入你的域名（Step 0.1 的 `your-domain.com`）→ Add
3. Resend 给你 3-4 条 DNS 记录（MX / SPF TXT / DKIM TXT / DMARC TXT），看起来像：
   ```
   Type=TXT  Name=send  Value=v=spf1 include:amazonses.com ~all
   Type=TXT  Name=resend._domainkey  Value=p=MIGfMA0GCSq...
   Type=MX   Name=send  Value=feedback-smtp.us-east-1.amazonses.com  Priority=10
   ```
4. **去 Cloudflare 添加 DNS 记录**（Step 0.1 的域名后台）：
   - Cloudflare dashboard → 选你的域名 → **DNS** → **Records** → **Add record**
   - 每一条 Resend 给的记录都对应加一条：
     - Type 选对应的（TXT/MX/CNAME）
     - Name 填 Resend 给的（如 `send`）
     - Content 填 Resend 给的 Value
     - Proxy status: **DNS only**（灰色云朵，不要走代理）→ Save
5. 加完后回 Resend dashboard → 点 **Verify DNS Records** → 等 1-5 分钟，全部变绿 ✓
6. Resend 左侧 **API Keys** → **Create API Key** → Name `prod-server` → Permission `Full access` → Create
7. **立刻复制弹出的 key**（关闭后看不到了）

**贴给我**：
```
RESEND_API_KEY=re_xxxxxxxxxxxx
RESEND_FROM_EMAIL=YourApp <noreply@your-domain.com>
```

→ 我会写入 `.env.production`，跑 preflight 的 Resend 检查，确认 `GET /domains` 返回 `verified` 状态。

---

## Step 3 — Cloudflare R2 对象存储（20 分钟，免费 10GB）

1. Cloudflare dashboard → 左侧 **R2 Object Storage** → 如果是第一次会让你开通（要求绑信用卡，但 10GB 内免费）
2. **Create bucket** → Name `sistine-prod-assets` → Location 选 **Asia-Pacific** → Create
3. 进入 bucket → **Settings** 标签 → **Public access** 部分 → **Connect Domain**
   - 输入子域名 `cdn.your-domain.com`
   - Cloudflare 自动给这个域名做 DNS 映射（点 Continue → Activate）
4. 进入 bucket → **CORS Policy** → **Add CORS policy** → 填：
   ```json
   [{
     "AllowedOrigins": ["https://your-domain.com", "https://www.your-domain.com"],
     "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
     "AllowedHeaders": ["*"],
     "MaxAgeSeconds": 3600
   }]
   ```
5. 回 R2 主页 → 右上 **Manage R2 API Tokens** → **Create API Token**
   - Token name: `sistine-prod-server`
   - Permissions: **Object Read & Write**
   - Specify bucket: 选 `sistine-prod-assets`
   - TTL: Forever
   - Create → **立刻复制** 三个值（关掉看不到了）：
     - Access Key ID
     - Secret Access Key
     - Endpoint (S3 API 那个 URL，形如 `https://<accountid>.r2.cloudflarestorage.com`)

**贴给我**：
```
STORAGE_BACKEND=r2
STORAGE_ACCESS_KEY_ID=xxx
STORAGE_SECRET_ACCESS_KEY=xxx
STORAGE_ENDPOINT=https://xxxxxxxx.r2.cloudflarestorage.com
STORAGE_PUBLIC_URL=https://cdn.your-domain.com
STORAGE_BUCKET_NAME=sistine-prod-assets
```

→ 我跑 preflight 的 storage round-trip，会真上传一张 1×1 PNG 然后取回来对比字节，确认绑定正确。

---

## Step 4 — OpenAI / 代理（5 分钟）

你已经有代理（`https://api.17xueai.cn/v1`），只需要：

**贴给我**（**注意：这两个值都属于密钥范畴，不要贴到 GitHub / 截图 / 公开聊天**）：
```
OPENAI_API_KEY=sk-xxxxxxxx
OPENAI_BASE_URL=https://api.17xueai.cn/v1
```

→ 我会写入 `.env.production`，跑 preflight 的 `GET /v1/models` 验证 key 有效。日志里 key 只显示末 4 位。

---

## Step 5 — Creem 支付（30 分钟，需要你创建产品）

1. 打开 https://creem.io → **Sign Up** → 完成商户认证（要营业执照等信息）
   - 如果你只是个人 / 还没法人，可以先跳过这步（不上线付费计划即可，免费用户照样能用）
2. 通过认证后 → dashboard → **Products** → **Create Product**：对每个计划单独创建（参考 `constants/billing.ts`）：
   | Product Name | Price | Billing | 创建后拿到 |
   |---|---|---|---|
   | Sistine Starter Monthly | $29 | recurring monthly | product ID `prod_xxx` |
   | Sistine Starter Yearly | $290 | recurring yearly | product ID `prod_xxx` |
   | Sistine Pro Monthly | $99 | recurring monthly | product ID `prod_xxx` |
   | Sistine Pro Yearly | $990 | recurring yearly | product ID `prod_xxx` |
   | Sistine Credit Pack 200 | $5 | one-time | product ID `prod_xxx` |
3. **API Keys** → 复制 `Secret API Key`
4. **Webhooks** → **Add Endpoint**：
   - URL: `https://your-domain.com/api/payments/creem/webhook`（**稍后部署完才有这个 URL，先填占位再回来改**）
   - Events 勾选: `checkout.completed`, `subscription.paid`, `subscription.active`
   - Create → 复制 **Signing Secret**

**贴给我**：
```
CREEM_API_KEY=xxx
CREEM_WEBHOOK_SECRET=whsec_xxx
CREEM_SIMULATE=false
# 5 个产品 ID（用于改 constants/billing.ts）：
STARTER_MONTHLY_PRODUCT_ID=prod_xxx
STARTER_YEARLY_PRODUCT_ID=prod_xxx
PRO_MONTHLY_PRODUCT_ID=prod_xxx
PRO_YEARLY_PRODUCT_ID=prod_xxx
CREDIT_PACK_200_PRODUCT_ID=prod_xxx
```

→ 我跑 preflight 的 HMAC 自验，确认 webhook secret 正确；并改 `constants/billing.ts` 把 5 个 `creemPriceId` 字段填上。

**注意**：如果你暂时跳过付费，只 BYO Key 模式，可以 `CREEM_SIMULATE=true`，付费按钮会走假流程不收钱。

---

## Step 6 — Vercel 部署（20 分钟）

1. 打开 https://vercel.com → **Sign Up** → **Continue with GitHub**（授权访问你的仓库）
2. dashboard → **Add New** → **Project** → 选你 Step 0.2 推过去的仓库 → **Import**
3. Framework Preset 会自动识别为 **Next.js** → 不用改
4. **Environment Variables** 部分 → 把我之前帮你拼好的 `.env.production` 一行行加进去（这一步我会给你一个直接可粘贴的列表）
5. 点 **Deploy** → 等 3-5 分钟构建
6. 构建成功 → 顶部给你一个临时域名 `sistine-prod-xxx.vercel.app`
7. **Settings** → **Domains** → Add `your-domain.com` 和 `www.your-domain.com`
   - Vercel 给你 2-3 条 DNS 记录（CNAME / A），去 Cloudflare DNS 加上（Proxy 选 **DNS only** 灰色云朵，不要走 Cloudflare 代理，否则 OAuth 回调会出问题）
   - 等 1-5 分钟 → 变绿 ✓

**贴给我**：
```
DEPLOY_URL=https://your-domain.com
```

→ 我做几件事：
1. 回 Creem dashboard 提示你把 webhook URL 改成真实地址
2. 跑远程 smoke：
   ```bash
   E2E_BASE_URL=https://your-domain.com pnpm exec tsx scripts/smoke-w5-uploads.ts
   ```
3. 创建你的 admin 账户（你先在站上正常注册一次普通账户，然后告诉我邮箱，我用 SQL 给你升 admin）

---

## Step 7 — 上线最后一公里（10 分钟）

按 [docs/deploy-readiness.md](./deploy-readiness.md) 第 9 节走一次首次 24h 验证：

- [ ] 你自己在站上注册一个账户 → 我查 `creditLedger` 应有 +300 注册赠送
- [ ] 你用 Creem 测试卡（如 `4242 4242 4242 4242`）走一次最小付费 → 我查 `payment` + `subscription` + `creditLedger` 三表对账
- [ ] 在 `/dashboard/studio/new` 提交一次单图任务 → 我看 `studio_task` 是否进入 `completed`
- [ ] 你查 Vercel 的 Cron tab，确认 `/api/cron/studio-reap` 和 `/api/cron/subscription-grants` 出现

---

## 我会从你这里要 4 个时刻点的协助

1. **每个 Step 完结时**：贴 secret 给我 → 我写入 + 局部 preflight 验证
2. **DNS 记录无法生效时**：你截图给我看 Cloudflare 那条记录的 Name / Type / Content，我对照 Resend / Vercel 要的内容找出差异
3. **构建失败时**：你把 Vercel 的 build log 复制粘贴给我，我修
4. **付费流程没跑通时**：你 Creem dashboard 截图给我看 webhook delivery，我对照后端日志找问题

---

## 你想象不到的几个坑（提前打疫苗）

1. **Resend 域名验证**：DNS 记录的 Name 字段，Cloudflare 不要带 `your-domain.com` 后缀，只填前缀（如 `send`）。如果 Cloudflare 自动追加了完整域名，会变成 `send.your-domain.com.your-domain.com` 死循环。
2. **R2 CORS**：必须显式列出 origin，`*` 在某些浏览器场景不工作。改了 CORS 后等 30s 生效。
3. **Vercel + Cloudflare**：DNS 记录的 Proxy（橙色云朵）一定关掉，走 **DNS only**。开了的话 Cloudflare 会 cache + 改 IP，导致 Vercel 看不到真实流量，OAuth 回调可能 404。
4. **Better Auth URL**：`BETTER_AUTH_URL` 和 `NEXT_PUBLIC_APP_URL` 一定填同一个 origin（如都填 `https://your-domain.com`），否则 cookie 设到 `www.` 但用户访问 `naked.` 会一直登不上。
5. **Creem 测试模式**：Creem 有 test mode 和 live mode。测试模式下 webhook 用的是不同的 secret，切到 live 后记得把 `.env.production` 的 `CREEM_WEBHOOK_SECRET` 换成 live 的。

---

## 全部完成的标志

```bash
ENV_FILE=.env.production pnpm exec tsx scripts/preflight-prod.ts
```

输出：
```
Pass: 15+   Warn: 0~2   Fail: 0   Skip: 0~1
Result: READY (all required checks pass).
```

然后 https://your-domain.com 能开站、注册、生成第一张图。
