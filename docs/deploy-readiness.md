# Deploy Readiness Checklist (Studio W1–W6)

Pre-flight before promoting `sistine + studio` from local dev to a hosted environment.
Order matters — items earlier on the list block items later.

---

## 1. Environment audit

Copy `.env.example` → `.env.local` (dev) or production secret store, and fill in:

### Hard requirements
| Var | Why | Where it's used |
|---|---|---|
| `DATABASE_URL` | Postgres (Neon/Supabase/Railway). Studio tables live here. | `lib/db/index.ts` |
| `BETTER_AUTH_SECRET` | Session + cookie signing; also fallback for BYO key encryption. | `lib/auth.ts`, `crypto.ts` |
| `BETTER_AUTH_URL` | Must match the public origin or auth callbacks 4xx. | `lib/auth.ts` |
| `NEXT_PUBLIC_APP_URL` | Used in emails & redirects — set to public origin. | many |
| `CRON_SECRET` **or** `CRON_JOBS_USERNAME`/`CRON_JOBS_PASSWORD` | Required to call `/api/cron/*` (subscription-grants, studio-reap). | `app/api/cron/*/route.ts` |

### Conditional requirements
| Var | When required |
|---|---|
| `OPENAI_API_KEY` + `OPENAI_BASE_URL` | When the platform runs gpt-image-2 calls itself (vs. BYO-only mode). **Treat as secret — never commit or log.** |
| `OPENAI_RESPONSES_MODEL`, `OPENAI_IMAGE_MODEL` | Override default model ids if upstream renames. |
| `BYO_KEY_MASTER_KEY` | Set explicitly in production. Without it, BYO keys are encrypted with `BETTER_AUTH_SECRET` — fine for dev, but rotating auth secret will brick stored keys. |
| `STORAGE_BACKEND=r2` + `STORAGE_*` | Production. With `data-url` fallback you'll bloat the DB on every generation. |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Any email flow (signup, password reset, purchase receipt). |
| `CREEM_API_KEY`, `CREEM_WEBHOOK_SECRET` | Anything with paid plans. Set `CREEM_SIMULATE=true` for staging without real money. |
| `AUTH_GOOGLE_ID` + `AUTH_GOOGLE_SECRET` | Google sign-in. Both must be set or the button is hidden. |

### Secret hygiene
- `.env.local` **must not** be committed (in `.gitignore` already).
- Never echo OPENAI key fragments to logs, build output, or screenshots.
- Rotate `BETTER_AUTH_SECRET` and `BYO_KEY_MASTER_KEY` independently; rotating either invalidates everything signed/encrypted with the old value.

---

## 2. Database

```bash
# Generate Drizzle migration files from schema.ts
pnpm db:generate

# Apply to target database
pnpm db:push     # fast path (dev / first deploy)
pnpm db:migrate  # uses ./drizzle/*.sql migration files (preferred in prod)
```

Studio W1–W5 added these tables (see `lib/db/schema.ts`):
- `studio_task`, `studio_task_event` — task lifecycle + SSE event log
- `studio_asset` — generated images + user-uploaded references (`task_id` is **nullable** for pre-task uploads)
- `studio_prompt_template` — saved prompt presets with usage stats
- `studio_user_provider_key` — encrypted BYO OpenAI keys
- `studio_quota_*` — per-user daily/monthly quotas
- `studio_pricing_*`, `studio_tier_*` — admin-tunable cost and tier policy

Verify after migration:
```sql
SELECT count(*) FROM information_schema.tables
WHERE table_schema = 'public' AND table_name LIKE 'studio_%';
-- Expect 9 studio tables (exact count depends on iteration).
```

---

## 3. Admin bootstrap

```bash
pnpm admin:setup
# or manually: UPDATE "user" SET role = 'admin' WHERE email = 'you@domain.com';
```

The studio admin pages (`/admin/studio-tasks`, `/admin/studio-assets`,
`/admin/studio-usage`, `/admin/studio-pricing`, `/admin/studio-tiers`) all
gate on `user.role = 'admin'`.

---

## 4. Cron jobs

Two cron callbacks must run on a schedule. Both honor `CRON_SECRET` bearer
**or** Basic-Auth with `CRON_JOBS_USERNAME` / `CRON_JOBS_PASSWORD`.

| Endpoint | Cadence | Purpose |
|---|---|---|
| `POST /api/cron/subscription-grants` | hourly | Drip-grant annual-plan credits into `creditLedger`. |
| `POST /api/cron/studio-reap` | every 5–10 min | Mark `status=running` tasks with stale `updated_at` as failed and refund reserved credits. **Without this, a runner crash locks reserved credits forever.** |

Vercel `vercel.json`:
```json
{
  "crons": [
    { "path": "/api/cron/subscription-grants", "schedule": "0 * * * *" },
    { "path": "/api/cron/studio-reap?staleAfterMs=600000&maxBatch=25", "schedule": "*/5 * * * *" }
  ]
}
```

External cron (cron-job.org / GitHub Actions):
```bash
curl -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  "https://your-domain.com/api/cron/studio-reap?staleAfterMs=600000"
```

Tunable params on `/studio-reap`:
- `staleAfterMs` — default 600000 (10 min). Min 60s, max 6h.
- `maxBatch` — default 25, max 100.

---

## 5. Creem webhook

In the Creem dashboard, register:
```
https://your-domain.com/api/payments/creem/webhook
```
Subscribe events: `checkout.completed`, `subscription.paid`, `subscription.active`.

Verify on first paid plan purchase:
- `payment` row inserted with `providerPaymentId`
- `subscription` row updated (status `active`, `currentPeriodEnd` ~+30d/+365d)
- `creditLedger` row with `reason='subscription_cycle'`
- `subscriptionCreditSchedule` row created for annual plans (12 grants)

---

## 6. Storage backend cutover

Decide **before** the first real user generation — switching backends after data exists requires a migration job.

| Mode | `STORAGE_BACKEND` | When |
|---|---|---|
| Local filesystem | `fs` + `STORAGE_FS_ROOT=/var/data/studio` | Single-host dev/staging only. |
| Cloudflare R2 (or S3) | `r2` + `STORAGE_*` filled in | Production. |
| Data URL (DB blob) | `data-url` or unset | Smoke tests / CI. Avoid for real traffic — every image becomes a base64 row. |

R2 bucket setup checklist:
- Public CDN domain mapped → `STORAGE_PUBLIC_URL`
- Lifecycle rule to expire orphaned `studio/tmp/*` (optional)
- CORS rule on `STORAGE_PUBLIC_URL` only if you stream/download cross-origin

---

## 7. Smoke tests

Run from the deployed environment (or against it) before opening to users:

```bash
# Preflight all env-bound integrations (DB, storage, OpenAI, Resend, Creem HMAC, etc.)
ENV_FILE=.env.production pnpm exec tsx scripts/preflight-prod.ts

# Studio task lifecycle (image_single + image_batch + decompose)
pnpm exec tsx scripts/smoke-w4.ts

# Multi-file reference uploads + gallery + prompt-template usage
pnpm exec tsx scripts/smoke-w5-uploads.ts

# Stale-task reaper invariants (status, credits, event)
pnpm exec tsx scripts/smoke-w6-reap.ts
```

All four must report `OK` exit code 0.

Also hit, in a browser logged in as a normal user:
- `/dashboard/studio` — task list loads, polls every 5s
- `/dashboard/studio/new` — submit a single-image task end-to-end
- `/dashboard/studio/gallery` — assets appear with thumbnails

---

## 8. Known gaps

The W1–W6 + Phase 2 progress against the original punch list:

1. ✅ **i18n extraction** — Phase 2 §1 + §3 (2026-05-23). All studio additions and the
   sistine shell go through `next-intl`. `pnpm exec tsx scripts/i18n-audit-w6.ts`
   and `scripts/i18n-audit-shell.ts` both report 0 hard-coded zh literals.

2. ✅ **SSE in the browser UI** — Phase 2 §2 (2026-05-23). `studio-shell.tsx` opens
   per-task `EventSource` connections (with a 30s safety poll) instead of the
   5s blanket refresh. Server-side SSE endpoint was already in place from W4.

3. ✅ **Old upload routes** — Phase 2 §5 (2026-05-23). Demo pages now use
   `/api/uploads/reference`. The two stub files (`/api/upload/image`,
   `/api/upload/simple`) return HTTP 410 Gone with a `migrateTo` hint and can
   be physically deleted after one release cycle once external callers have
   migrated.

4. ❌ **Cloud account swap** — owner-driven. Neon (DB), R2 (storage), Resend (mail),
   Railway/Vercel (host) provisioning is required before cutover. Once credentials
   land, point `ENV_FILE` at the production env file and run:
   ```bash
   ENV_FILE=.env.production pnpm exec tsx scripts/preflight-prod.ts
   ```
   It validates auth secrets, pings DB + lists `studio_*` tables, round-trips a 1×1
   PNG through the configured storage backend, hits `GET /v1/models` against the
   OpenAI base URL, fetches `GET /domains` from Resend, and HMAC-self-tests the
   Creem webhook secret (sign + verify + reject-bogus). Never logs key bodies —
   only last-4 hints. Exit 0 if every required check passes; exit 1 otherwise.
   Code-side: zero changes.

5. ❌ **Worker lease heartbeat** — Phase 3. The current `task-runner` is short-lived
   (hit `/api/studio/tasks/run` or rely on a polling cron). `/api/cron/studio-reap`
   already covers crash recovery for now. Migrating to a long-running worker with
   a `lease_expires_at` heartbeat is a larger architectural change.

---

## 9. Post-deploy verification (first 24h)

- [ ] First real signup → `creditLedger` row with `reason='registration_bonus'` and `delta=300`
- [ ] First paid checkout → `payment` + `subscription` + `creditLedger` rows all present, no webhook retries in Creem dashboard
- [ ] First image generation → `studio_task` reaches `completed`, asset stored at `STORAGE_PUBLIC_URL`, credits deducted matches `creditsFinal`
- [ ] Cron `/studio-reap` returns `{ ok: true, totalReaped: 0 }` on first run (no stale tasks)
- [ ] Cron `/subscription-grants` either returns empty or processes the first annual sub correctly

If any of the above misfires, fix before user volume grows — bad ledger state at scale is much harder to reconcile retroactively.
