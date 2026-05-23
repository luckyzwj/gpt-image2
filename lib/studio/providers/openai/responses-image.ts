import { assertOpenAIImageProviderConfig, type ResolvedProviderConfig } from "@/lib/studio/providers/openai/config";

type ReferenceImage = {
  base64: string;
  mimeType: string;
  label?: string;
};

type GenerateStudioImageRequest = {
  prompt: string;
  size?: string;
  quality?: "low" | "medium" | "high" | "auto";
  format?: "png" | "jpeg" | "webp";
  referenceImages?: ReferenceImage[];
  responsesModel?: string;
  providerConfig?: ResolvedProviderConfig;
};

type OpenAIErrorShape = {
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
};

function normalizeBase64(value: string) {
  return String(value).replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, "").trim();
}

function buildResponsesInput(prompt: string, referenceImages: ReferenceImage[] = []) {
  if (referenceImages.length === 0) {
    return prompt;
  }

  const content: Array<Record<string, string>> = [{ type: "input_text", text: prompt }];

  for (const image of referenceImages) {
    if (image.label) {
      content.push({ type: "input_text", text: image.label });
    }

    content.push({
      type: "input_image",
      image_url: `data:${image.mimeType};base64,${normalizeBase64(image.base64)}`,
    });
  }

  return [{ role: "user", content }];
}

function extractImageBase64(payload: Record<string, unknown>) {
  const candidates: Array<unknown> = [
    (payload as { result?: string }).result,
    (payload as { b64_json?: string }).b64_json,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  const output = (payload as { output?: Array<Record<string, unknown>> }).output;
  if (Array.isArray(output)) {
    for (const item of output) {
      if (item.type === "image_generation_call" && typeof item.result === "string") {
        return item.result;
      }
    }
  }

  const response = (payload as { response?: Record<string, unknown> }).response;
  const responseOutput = response?.output;
  if (Array.isArray(responseOutput)) {
    for (const item of responseOutput) {
      if (item && typeof item === "object" && (item as { type?: string }).type === "image_generation_call") {
        const result = (item as { result?: string }).result;
        if (typeof result === "string" && result.length > 0) {
          return result;
        }
      }
    }
  }

  return "";
}

export async function generateStudioImage({
  prompt,
  size = "1024x1024",
  quality = "high",
  format = "png",
  referenceImages = [],
  responsesModel,
  providerConfig,
}: GenerateStudioImageRequest) {
  if (!prompt.trim()) {
    throw new Error("prompt is required");
  }

  const config = providerConfig ?? assertOpenAIImageProviderConfig();
  const endpoint = `${config.baseUrl}/responses`;
  const model = responsesModel || config.responsesModel;

  const requestBody = {
    model,
    input: buildResponsesInput(prompt.trim(), referenceImages),
    stream: false,
    tool_choice: { type: "image_generation" },
    tools: [
      {
        type: "image_generation",
        model: config.imageModel,
        size,
        quality,
        output_format: format,
        background: "opaque",
      },
    ],
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    let detail = "";
    try {
      const errorPayload = (await response.json()) as OpenAIErrorShape;
      detail = errorPayload.error?.message || "";
    } catch {
      detail = await response.text();
    }
    throw new Error(`OpenAI responses error ${response.status}: ${detail || "Unknown error"}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const imageBase64 = extractImageBase64(payload);
  if (!imageBase64) {
    throw new Error("No image output found in OpenAI response");
  }

  return {
    imageBase64: normalizeBase64(imageBase64),
    model,
    format,
    raw: payload,
  };
}
