CREATE TABLE "studio_article_set" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"status" varchar(24) DEFAULT 'planned' NOT NULL,
	"plan_json" text,
	"manifest_json" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio_asset" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"user_id" text NOT NULL,
	"asset_type" varchar(24) NOT NULL,
	"storage_key" text,
	"public_url" text NOT NULL,
	"mime_type" varchar(128),
	"width" integer,
	"height" integer,
	"size_bytes" integer,
	"metadata_json" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio_creation_set" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"status" varchar(24) DEFAULT 'planned' NOT NULL,
	"plan_json" text,
	"manifest_json" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio_ppt_deck" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"status" varchar(24) DEFAULT 'planned' NOT NULL,
	"plan_json" text,
	"manifest_json" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio_task" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"task_type" varchar(48) NOT NULL,
	"status" varchar(24) DEFAULT 'queued' NOT NULL,
	"request_json" text,
	"result_json" text,
	"credits_reserved" integer DEFAULT 0 NOT NULL,
	"credits_final" integer DEFAULT 0 NOT NULL,
	"credits_refunded" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 2 NOT NULL,
	"error_code" varchar(64),
	"error_message" text,
	"queued_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "studio_task_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "studio_task_event" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"event_type" varchar(48) NOT NULL,
	"progress" integer,
	"payload_json" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "studio_article_set" ADD CONSTRAINT "studio_article_set_task_id_studio_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."studio_task"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_article_set" ADD CONSTRAINT "studio_article_set_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_asset" ADD CONSTRAINT "studio_asset_task_id_studio_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."studio_task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_asset" ADD CONSTRAINT "studio_asset_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_creation_set" ADD CONSTRAINT "studio_creation_set_task_id_studio_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."studio_task"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_creation_set" ADD CONSTRAINT "studio_creation_set_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_ppt_deck" ADD CONSTRAINT "studio_ppt_deck_task_id_studio_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."studio_task"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_ppt_deck" ADD CONSTRAINT "studio_ppt_deck_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_task" ADD CONSTRAINT "studio_task_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_task_event" ADD CONSTRAINT "studio_task_event_task_id_studio_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."studio_task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "studio_article_set_user_created_at_idx" ON "studio_article_set" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "studio_asset_user_created_at_idx" ON "studio_asset" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "studio_asset_task_idx" ON "studio_asset" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "studio_creation_set_user_created_at_idx" ON "studio_creation_set" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "studio_ppt_deck_user_created_at_idx" ON "studio_ppt_deck" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "studio_task_status_queued_at_idx" ON "studio_task" USING btree ("status","queued_at");--> statement-breakpoint
CREATE INDEX "studio_task_user_created_at_idx" ON "studio_task" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "studio_task_event_task_created_at_idx" ON "studio_task_event" USING btree ("task_id","created_at");