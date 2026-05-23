export const STUDIO_TASK_TYPES = [
  "image_single",
  "image_decompose",
  "creation_plan",
  "creation_generate",
  "article_plan",
  "article_generate",
  "ppt_plan",
  "ppt_generate",
] as const;

export type StudioTaskType = (typeof STUDIO_TASK_TYPES)[number];

export const STUDIO_TASK_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
  "canceled",
  "partial_failed",
] as const;

export type StudioTaskStatus = (typeof STUDIO_TASK_STATUSES)[number];

export const STUDIO_ASSET_TYPES = ["image", "video", "pptx", "reference"] as const;
export type StudioAssetType = (typeof STUDIO_ASSET_TYPES)[number];

export type StudioTaskRequestPayload = Record<string, unknown>;
export type StudioTaskResultPayload = Record<string, unknown>;

export interface StudioTaskListParams {
  limit?: number;
  status?: StudioTaskStatus;
  taskType?: StudioTaskType;
}

export interface StudioTaskEventInput {
  eventType: string;
  payload?: Record<string, unknown>;
  progress?: number;
}

export interface StudioImageSingleRequest {
  prompt: string;
  size?: string;
  quality?: "low" | "medium" | "high" | "auto";
  format?: "png" | "jpeg" | "webp";
  referenceImages?: Array<{
    base64: string;
    mimeType: string;
  }>;
}

export interface StudioCreationPlanRequest {
  productName: string;
  productDescription: string;
  sellingPoints: string[];
  imageCount: number;
  scenario?: string;
  locale?: string;
}

export interface StudioCreationGenerateRequest {
  planId: string;
  imageCount: number;
  prompts: string[];
}
