import { pgTable, text, timestamp, boolean, integer, varchar, index } from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  // total available credits for the user
  credits: integer("credits").default(0).notNull(),
  // user role: 'admin' | 'user'
  role: text("role").default("user").notNull(),
  // current subscription plan
  planKey: text("plan_key").default("free"),
  // ban status
  banned: boolean("banned").default(false).notNull(),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .$onUpdate(() => new Date())
    .notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .$onUpdate(() => new Date())
    .notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

// Payment records (one-time purchases and subscription renewals)
export const payment = pgTable("payment", {
  id: text("id").primaryKey(),
  provider: varchar("provider", { length: 32 }).default("creem").notNull(),
  providerPaymentId: text("provider_payment_id").notNull().unique(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  amountCents: integer("amount_cents").notNull(),
  currency: varchar("currency", { length: 8 }).default("usd").notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  type: varchar("type", { length: 32 }).notNull(), // 'one_time' | 'subscription'
  planKey: varchar("plan_key", { length: 64 }),
  creditsGranted: integer("credits_granted").default(0).notNull(),
  raw: text("raw"), // store provider payload as JSON string
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Active subscriptions
export const subscription = pgTable("subscription", {
  id: text("id").primaryKey(),
  provider: varchar("provider", { length: 32 }).default("creem").notNull(),
  providerSubId: text("provider_sub_id").notNull().unique(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  planKey: varchar("plan_key", { length: 64 }).notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  currentPeriodEnd: timestamp("current_period_end"),
  raw: text("raw"), // store provider payload as JSON string
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
});

// Credit ledger for auditability
export const creditLedger = pgTable("credit_ledger", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  delta: integer("delta").notNull(),
  reason: varchar("reason", { length: 64 }).notNull(), // 'subscription_cycle' | 'one_time_pack' | 'adjustment' | 'chat_usage' | ...
  paymentId: text("payment_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const subscriptionCreditSchedule = pgTable(
  "subscription_credit_schedule",
  {
    id: text("id").primaryKey(),
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => subscription.id, { onDelete: "cascade" })
      .unique(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    planKey: varchar("plan_key", { length: 64 }).notNull(),
    creditsPerGrant: integer("credits_per_grant").notNull(),
    intervalMonths: integer("interval_months").notNull(),
    grantsRemaining: integer("grants_remaining").notNull(),
    totalCreditsRemaining: integer("total_credits_remaining").notNull(),
    nextGrantAt: timestamp("next_grant_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    nextGrantIdx: index("subscription_credit_schedule_next_grant_idx").on(table.nextGrantAt),
  }),
);

// Chat sessions
export const chatSession = pgTable("chat_session", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  title: text("title"),
  model: varchar("model", { length: 48 }).default("doubao-1-5-thinking-pro-250415").notNull(),
  totalMessages: integer("total_messages").default(0).notNull(),
  totalCreditsUsed: integer("total_credits_used").default(0).notNull(),
  lastMessageAt: timestamp("last_message_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
});

// Chat messages
export const chatMessage = pgTable("chat_message", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => chatSession.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 16 }).notNull(), // 'user' | 'assistant' | 'system'
  content: text("content").notNull(),
  creditsUsed: integer("credits_used").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Generation history for images and videos
export const generationHistory = pgTable("generation_history", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 16 }).notNull(), // 'image' | 'video'
  prompt: text("prompt").notNull(),
  imageUrl: text("image_url"), // For image-to-video generation
  resultUrl: text("result_url"), // Final result URL
  taskId: text("task_id"), // For async video generation tracking
  status: varchar("status", { length: 16 }).notNull().default("pending"), // pending, processing, completed, failed
  creditsUsed: integer("credits_used").default(0).notNull(),
  metadata: text("metadata"), // JSON string for additional data
  error: text("error"), // Error message if failed
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
});

// Password reset tokens
export const passwordResetToken = pgTable("password_reset_token", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Newsletter subscriptions
export const newsletterSubscription = pgTable("newsletter_subscription", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
  status: varchar("status", { length: 16 }).notNull().default("active"), // active, unsubscribed
  unsubscribeToken: text("unsubscribe_token").notNull().unique(),
  subscribedAt: timestamp("subscribed_at").defaultNow().notNull(),
  unsubscribedAt: timestamp("unsubscribed_at"),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
});

// Studio async tasks
export const studioTask = pgTable(
  "studio_task",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    taskType: varchar("task_type", { length: 48 }).notNull(),
    status: varchar("status", { length: 24 }).notNull().default("queued"),
    requestJson: text("request_json"),
    resultJson: text("result_json"),
    creditsReserved: integer("credits_reserved").default(0).notNull(),
    creditsFinal: integer("credits_final").default(0).notNull(),
    creditsRefunded: integer("credits_refunded").default(0).notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    retryCount: integer("retry_count").default(0).notNull(),
    maxRetries: integer("max_retries").default(2).notNull(),
    errorCode: varchar("error_code", { length: 64 }),
    errorMessage: text("error_message"),
    queuedAt: timestamp("queued_at").defaultNow().notNull(),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    statusQueuedAtIdx: index("studio_task_status_queued_at_idx").on(table.status, table.queuedAt),
    userCreatedAtIdx: index("studio_task_user_created_at_idx").on(table.userId, table.createdAt),
  }),
);

// Studio task progress / event stream snapshots
export const studioTaskEvent = pgTable(
  "studio_task_event",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => studioTask.id, { onDelete: "cascade" }),
    eventType: varchar("event_type", { length: 48 }).notNull(),
    progress: integer("progress"),
    payloadJson: text("payload_json"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  table => ({
    taskCreatedAtIdx: index("studio_task_event_task_created_at_idx").on(table.taskId, table.createdAt),
  }),
);

// Studio generated assets
export const studioAsset = pgTable(
  "studio_asset",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").references(() => studioTask.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    assetType: varchar("asset_type", { length: 24 }).notNull(),
    storageKey: text("storage_key"),
    publicUrl: text("public_url").notNull(),
    mimeType: varchar("mime_type", { length: 128 }),
    width: integer("width"),
    height: integer("height"),
    sizeBytes: integer("size_bytes"),
    metadataJson: text("metadata_json"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  table => ({
    userCreatedAtIdx: index("studio_asset_user_created_at_idx").on(table.userId, table.createdAt),
    taskIdx: index("studio_asset_task_idx").on(table.taskId),
  }),
);

// Studio creation workflow sets
export const studioCreationSet = pgTable(
  "studio_creation_set",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").references(() => studioTask.id, { onDelete: "set null" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: varchar("status", { length: 24 }).notNull().default("planned"),
    planJson: text("plan_json"),
    manifestJson: text("manifest_json"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    userCreatedAtIdx: index("studio_creation_set_user_created_at_idx").on(table.userId, table.createdAt),
  }),
);

// Studio article illustration workflow sets
export const studioArticleSet = pgTable(
  "studio_article_set",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").references(() => studioTask.id, { onDelete: "set null" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: varchar("status", { length: 24 }).notNull().default("planned"),
    planJson: text("plan_json"),
    manifestJson: text("manifest_json"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    userCreatedAtIdx: index("studio_article_set_user_created_at_idx").on(table.userId, table.createdAt),
  }),
);

// Studio PPT workflow decks
export const studioPptDeck = pgTable(
  "studio_ppt_deck",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").references(() => studioTask.id, { onDelete: "set null" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: varchar("status", { length: 24 }).notNull().default("planned"),
    planJson: text("plan_json"),
    manifestJson: text("manifest_json"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    userCreatedAtIdx: index("studio_ppt_deck_user_created_at_idx").on(table.userId, table.createdAt),
  }),
);

// Studio prompt templates — reusable, per-user library of named prompts
export const studioPromptTemplate = pgTable(
  "studio_prompt_template",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prompt: text("prompt").notNull(),
    category: varchar("category", { length: 48 }).default("general").notNull(),
    tags: text("tags"),
    favorite: boolean("favorite").default(false).notNull(),
    usageCount: integer("usage_count").default(0).notNull(),
    lastUsedAt: timestamp("last_used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    userCreatedAtIdx: index("studio_prompt_template_user_created_at_idx").on(table.userId, table.createdAt),
    userFavoriteIdx: index("studio_prompt_template_user_favorite_idx").on(table.userId, table.favorite),
  }),
);

// Studio pricing config — admin-editable credit prices per task type
// One row per task type. `priceCredits` is the per-unit credit cost used by cost-policy.ts.
// Optional `quality` lets us support heuristic pricing (low=1/med=2/high=4/xhigh=8) in future.
export const studioPricingConfig = pgTable(
  "studio_pricing_config",
  {
    id: text("id").primaryKey(),
    taskType: varchar("task_type", { length: 48 }).notNull(),
    quality: varchar("quality", { length: 16 }).default("default").notNull(),
    priceCredits: integer("price_credits").notNull(),
    minBatchSize: integer("min_batch_size").default(1).notNull(),
    maxBatchSize: integer("max_batch_size").default(1).notNull(),
    defaultBatchSize: integer("default_batch_size").default(1).notNull(),
    notes: text("notes"),
    enabled: boolean("enabled").default(true).notNull(),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    taskTypeQualityIdx: index("studio_pricing_config_task_quality_idx").on(table.taskType, table.quality),
  }),
);

// Studio tier config — admin-editable per-tier quotas applied to studio tasks.
// One row per tier key (e.g. "free", "starter", "pro"). Effective limits for a user are
// derived from their plan_key, then overridden per-user by studio_user_quota_override.
export const studioTierConfig = pgTable(
  "studio_tier_config",
  {
    id: text("id").primaryKey(),
    tierKey: varchar("tier_key", { length: 48 }).notNull().unique(),
    displayName: text("display_name").notNull(),
    dailyTaskLimit: integer("daily_task_limit").default(50).notNull(),
    dailyCreditLimit: integer("daily_credit_limit").default(1000).notNull(),
    concurrentTaskLimit: integer("concurrent_task_limit").default(3).notNull(),
    maxPromptTemplates: integer("max_prompt_templates").default(20).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    notes: text("notes"),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
);

// Studio user quota override — per-user override of tier-level limits. NULL fields
// fall through to the tier's value. `expiresAt` lets admins issue temporary boosts.
export const studioUserQuotaOverride = pgTable(
  "studio_user_quota_override",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" })
      .unique(),
    dailyTaskLimit: integer("daily_task_limit"),
    dailyCreditLimit: integer("daily_credit_limit"),
    concurrentTaskLimit: integer("concurrent_task_limit"),
    maxPromptTemplates: integer("max_prompt_templates"),
    reason: text("reason"),
    expiresAt: timestamp("expires_at"),
    grantedBy: text("granted_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
);

// Studio user API keys — encrypted BYO credentials. One row per (user, provider).
// `encryptedKey` stores the AES-256-GCM ciphertext (base64). `keyHint` is the last
// 4 chars for display. Platform charges a fixed 1-credit fee per image when active.
export const studioUserApiKey = pgTable(
  "studio_user_api_key",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 32 }).notNull().default("openai"),
    encryptedKey: text("encrypted_key").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    keyHint: varchar("key_hint", { length: 8 }).notNull(),
    baseUrl: text("base_url"),
    enabled: boolean("enabled").default(true).notNull(),
    lastUsedAt: timestamp("last_used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    userProviderIdx: index("studio_user_api_key_user_provider_idx").on(table.userId, table.provider),
  }),
);
