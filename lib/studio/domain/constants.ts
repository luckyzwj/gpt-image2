import type { StudioTaskStatus, StudioTaskType } from "@/lib/studio/domain/types";

export const STUDIO_TASK_DEFAULT_LIMIT = 20;
export const STUDIO_TASK_MAX_LIMIT = 100;

export const STUDIO_TERMINAL_STATUSES: StudioTaskStatus[] = [
  "completed",
  "failed",
  "canceled",
  "partial_failed",
];

export const STUDIO_RETRYABLE_STATUSES: StudioTaskStatus[] = ["failed", "partial_failed"];

export const STUDIO_TASK_DEFAULT_MAX_RETRIES = 2;

export const STUDIO_SUPPORTED_TASK_TYPES: StudioTaskType[] = [
  "image_single",
  "creation_plan",
  "creation_generate",
  "article_plan",
  "article_generate",
  "ppt_plan",
  "ppt_generate",
];
