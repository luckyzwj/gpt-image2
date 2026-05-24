import { getApiErrorMessage } from "./error-utils";

export interface ClientSubscriptionSummary {
  planKey: string;
  status: string;
  currentPeriodEnd: string | Date | null;
}

export interface ClientUserProfile {
  id: string;
  name: string | null;
  email: string;
  emailVerified: boolean;
  image: string | null;
  credits: number;
  createdAt: string | Date;
  subscription: ClientSubscriptionSummary | null;
}

export interface UserProfileResponse {
  user: ClientUserProfile;
}

export interface CreditHistoryRecord {
  id: string;
  amount: number;
  type: string;
  reason: string;
  createdAt: string | Date;
  paymentId: string | null;
}

export interface CreditHistoryResponse {
  history: CreditHistoryRecord[];
  totalCount: number;
  hasMore: boolean;
}

export interface ApiErrorResponse {
  error?: string;
}

export type ChatStreamEvent =
  | {
      type: "metadata";
      sessionId: string;
      remainingCredits: number | null;
    }
  | {
      type: "content";
      content: string;
    }
  | {
      type: "done";
    }
  | {
      type: "error";
      error: string;
    };

export interface ImageGenerationResponsePayload {
  id: string;
  url: string;
  revisedPrompt?: string;
  remainingCredits: number | null;
  sourceImageUrl?: string;
}

export interface UploadImageResponse {
  url: string;
  filename?: string;
}

export interface VideoGenerationResponsePayload {
  id: string;
  taskId: string;
  status: "pending" | "processing" | "completed" | "failed";
  remainingCredits: number | null;
}

export interface VideoStatusResponsePayload {
  id: string;
  taskId: string;
  status: "pending" | "processing" | "completed" | "failed";
  videoUrl?: string;
  error?: string;
  message?: string;
}

export type StudioTaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "canceled"
  | "partial_failed";

export type StudioTaskType =
  | "image_single"
  | "image_decompose"
  | "creation_plan"
  | "creation_generate"
  | "article_plan"
  | "article_generate"
  | "ppt_plan"
  | "ppt_generate";

export interface StudioTaskSummary {
  id: string;
  userId: string;
  taskType: StudioTaskType;
  status: StudioTaskStatus;
  creditsReserved: number;
  creditsFinal: number;
  creditsRefunded: number;
  errorMessage: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  completedAt: string | Date | null;
  request: Record<string, unknown>;
  result: Record<string, unknown>;
}

export interface StudioTaskEvent {
  id: string;
  taskId: string;
  eventType: string;
  progress: number | null;
  createdAt: string | Date;
  payload: Record<string, unknown>;
}

export interface StudioAsset {
  id: string;
  taskId: string | null;
  userId: string;
  assetType: "image" | "video" | "pptx" | "reference";
  publicUrl: string;
  storageKey: string | null;
  mimeType: string | null;
  createdAt: string | Date;
  metadata: Record<string, unknown>;
}

type ReferenceUploadResponse = {
  assets: Array<{
    publicUrl: string;
    storageKey: string;
    mimeType: string;
    width: number | null;
    height: number | null;
    sizeBytes: number;
    filename: string;
  }>;
  errors: Array<{ filename: string; error: string }>;
};

export async function uploadDemoImage(file: File): Promise<UploadImageResponse> {
  const fd = new FormData();
  fd.append("files", file);
  const res = await fetch("/api/uploads/reference", { method: "POST", body: fd });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as ApiErrorResponse;
    throw new Error(getApiErrorMessage(err, "Upload failed"));
  }
  const data = (await res.json()) as ReferenceUploadResponse;
  if (data.errors?.length) {
    throw new Error(data.errors[0].error || "Upload failed");
  }
  const asset = data.assets?.[0];
  if (!asset) {
    throw new Error("No asset returned");
  }
  return { url: asset.publicUrl, filename: asset.filename };
}
