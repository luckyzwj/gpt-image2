# 部署 Checklist — gptimgprompts.com

按顺序点完即可上线。所有命令都给你了，不用想。

---

## 0 · 前置准备(只做一次)

- [ ] **Cloudflare 账号**:登录 https://dash.cloudflare.com,记下 Account ID(右下角)
- [ ] **本机安装 wrangler**:
  ```bash
  npm install -g wrangler
  wrangler login
  ```

## 1 · 生成两个共享密钥

随机一次,两边都用同一个值。

```bash
# 在任意机器上跑一次,把输出复制下来
openssl rand -base64 48
```

记下来,后面叫它 `<STUDIO_GATEWAY_SECRET>`。

## 2 · 创建 Cloudflare R2 bucket(存图)

```bash
wrangler r2 bucket create gpt-image2-studio-images
```

## 3 · 创建 Cloudflare Queue(任务编排)

```bash
wrangler queues create gpt-image2-studio-generation
```

## 4 · 部署 aEboli Worker

```bash
cd d:/gpt-image2/GPT-Image2-Studio

# 写 secrets(每条会提示你粘贴值)
wrangler secret put STUDIO_GATEWAY_SECRET --config wrangler.api.jsonc
# 粘贴第 1 步的 <STUDIO_GATEWAY_SECRET>

wrangler secret put OPENAI_API_KEY --config wrangler.api.jsonc
# 粘贴你的代理 key

wrangler secret put OPENAI_BASE_URL --config wrangler.api.jsonc
# 粘贴你的代理 URL(例如 https://your-proxy.com/v1)

# 部署
wrangler deploy --config wrangler.api.jsonc
```

部署完成后控制台会打印 worker URL,形如:
```
https://gpt-image2-studio-api.<your-subdomain>.workers.dev
```
**复制下来**,后面叫它 `<AEBOLI_URL>`。

## 5 · 配置 Vercel 环境变量

在 Vercel 项目 `gptimgprompts` → Settings → Environment Variables 加这两条:

| Name | Value | Environment |
|------|-------|-------------|
| `STUDIO_GATEWAY_ORIGIN` | `<AEBOLI_URL>` (上一步拿到的) | Production + Preview |
| `STUDIO_GATEWAY_SECRET` | 第 1 步的随机串 | Production + Preview |

保存后会自动触发重新部署,或者:

```bash
vercel --prod
```

## 6 · 跑数据库迁移(删 Studio 表)

```bash
cd d:/gpt-image2/GPT-Image2-Studio/sistine/sistine-starter-vibe-to-production-main
pnpm db:generate
pnpm db:migrate
```

生成的 SQL 会有 `DROP TABLE studio_*`。**先在 Drizzle Studio 里看一眼内容再 migrate**,确认旧 Studio 表里没有要留的数据。

## 7 · 验证(smoke test)

打开 `https://img.gptimgprompts.com`:

- [ ] 登录(应该能进)
- [ ] 浏览器 DevTools → Network,跑一次任意需要 credits 的页面
- [ ] 直接访问 `https://img.gptimgprompts.com/studio/api/health` (如果 worker 有这条路由)
  - 期待:登录态下返回 200;未登录返回 401
- [ ] 直接访问 `<AEBOLI_URL>/api/health`
  - 期待:401(因为没 HMAC 头),这证明 worker 拒绝绕过 sistine 的请求

---

## 出错时排查

| 症状 | 看哪 |
|------|------|
| `/studio/*` 返回 500 "STUDIO_GATEWAY_ORIGIN is not configured" | Vercel env 没设上,或没重新部署 |
| `/studio/*` 返回 500 "STUDIO_GATEWAY_SECRET is missing or shorter than 32 chars" | secret 没设 / 设了空值 |
| `/studio/*` 返回 401 "Invalid studio signature" | sistine 和 aEboli 的 secret 不一致 |
| `/studio/*` 返回 401 "Signature timestamp out of window" | 两端时间偏差超 5 分钟,检查服务器 NTP |
| `/studio/*` 返回 502 | worker 没部署 / 域名错 |
| 用户余额扣了但任务失败 | 看 `creditLedger` 表里 `reason LIKE '%_refund_%'`,正常应有反向条目 |

---

## 涉及的密钥(绝对不要进 git)

- `STUDIO_GATEWAY_SECRET` — HMAC 共享密钥
- `OPENAI_API_KEY` — 代理 key
- `OPENAI_BASE_URL` — 代理 URL
- `BETTER_AUTH_SECRET` — 已有
- `CREEM_API_KEY` / `CREEM_WEBHOOK_SECRET` — 已有
- `DATABASE_URL` — 已有
- `RESEND_API_KEY` — 已有
