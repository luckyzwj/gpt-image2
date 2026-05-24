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

// Studio 类型已下沉到 Cloudflare Pages Worker (aEboli),前端通过反代访问 /studio/api/*。

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
