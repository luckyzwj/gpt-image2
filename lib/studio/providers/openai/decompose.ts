import { assertOpenAIImageProviderConfig, type ResolvedProviderConfig } from "@/lib/studio/providers/openai/config";

export type DecomposeDepth = "brief" | "detailed";

export type StudioImageAnalysis = {
  description: string;
  subject: string;
  style: string;
  composition: string;
  colors: string[];
  mood: string;
  lighting: string;
  suggestedPrompts: string[];
};

type DecomposeRequest = {
  imageBase64: string;
  mimeType: string;
  depth?: DecomposeDepth;
  locale?: string;
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

function buildInstruction(depth: DecomposeDepth, locale: string) {
  const isZh = locale.toLowerCase().startsWith("zh");
  const detail =
    depth === "brief"
      ? isZh
        ? "请用简洁的语言（每个字段 1-2 句）描述图片。"
        : "Use concise language (1-2 sentences per field) to describe the image."
      : isZh
        ? "请提供详细分析，描述要丰富、风格分析要具体、构图说明要明确。"
        : "Provide a thorough analysis with rich descriptions, specific style notes, and clear compositional reasoning.";

  const schemaNote = isZh
    ? `严格按照如下 JSON 结构返回，不要返回任何额外文本：
{
  "description": "整体内容概述",
  "subject": "主体对象（人物/物品/场景）",
  "style": "艺术风格、媒介或视觉流派",
  "composition": "构图、视角、画面布局",
  "colors": ["主色调", "..."],
  "mood": "氛围或情绪",
  "lighting": "光线特征",
  "suggestedPrompts": [
    "可直接复用的生成 prompt 1",
    "可直接复用的生成 prompt 2",
    "可直接复用的生成 prompt 3"
  ]
}`
    : `Return STRICT JSON matching the following schema and nothing else:
{
  "description": "Overall content summary",
  "subject": "Main subject (person/object/scene)",
  "style": "Artistic style, medium, or visual genre",
  "composition": "Composition, viewpoint, framing",
  "colors": ["dominant color", "..."],
  "mood": "Mood or emotion",
  "lighting": "Lighting characteristics",
  "suggestedPrompts": [
    "ready-to-reuse generation prompt 1",
    "ready-to-reuse generation prompt 2",
    "ready-to-reuse generation prompt 3"
  ]
}`;

  return `${detail}\n\n${schemaNote}`;
}

function extractText(payload: Record<string, unknown>): string {
  const direct = (payload as { output_text?: string }).output_text;
  if (typeof direct === "string" && direct.trim().length > 0) {
    return direct;
  }

  const output = (payload as { output?: Array<Record<string, unknown>> }).output;
  if (Array.isArray(output)) {
    const chunks: string[] = [];
    for (const item of output) {
      const content = (item as { content?: Array<Record<string, unknown>> }).content;
      if (Array.isArray(content)) {
        for (const part of content) {
          const text = (part as { text?: string }).text;
          if (typeof text === "string" && text.length > 0) {
            chunks.push(text);
          }
        }
      }
    }
    if (chunks.length > 0) {
      return chunks.join("\n");
    }
  }

  return "";
}

function extractJsonFromText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      // fall through
    }
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch {
      // fall through
    }
  }

  return null;
}

function toStringValue(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim();
  if (value == null) return fallback;
  return String(value);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => (typeof item === "string" ? item.trim() : String(item ?? "").trim()))
    .filter(item => item.length > 0);
}

function normalizeAnalysis(raw: unknown): StudioImageAnalysis {
  const record = (raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}) || {};
  return {
    description: toStringValue(record.description),
    subject: toStringValue(record.subject),
    style: toStringValue(record.style),
    composition: toStringValue(record.composition),
    colors: toStringArray(record.colors),
    mood: toStringValue(record.mood),
    lighting: toStringValue(record.lighting),
    suggestedPrompts: toStringArray(record.suggestedPrompts),
  };
}

export async function decomposeStudioImage({
  imageBase64,
  mimeType,
  depth = "detailed",
  locale = "zh",
  responsesModel,
  providerConfig,
}: DecomposeRequest) {
  if (!imageBase64 || !imageBase64.trim()) {
    throw new Error("imageBase64 is required");
  }

  const config = providerConfig ?? assertOpenAIImageProviderConfig();
  const endpoint = `${config.baseUrl}/responses`;
  const model = responsesModel || config.responsesModel;

  const sanitizedMime = mimeType && mimeType.includes("/") ? mimeType : "image/png";
  const dataUrl = `data:${sanitizedMime};base64,${normalizeBase64(imageBase64)}`;

  const requestBody = {
    model,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: buildInstruction(depth, locale) },
          { type: "input_image", image_url: dataUrl },
        ],
      },
    ],
    stream: false,
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    let detail = "";
    try {
      const errorPayload = (await response.json()) as OpenAIErrorShape;
      detail = errorPayload.error?.message || "";
    } catch {
      detail = await response.text();
    }
    throw new Error(`OpenAI decompose error ${response.status}: ${detail || "Unknown error"}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const text = extractText(payload);
  if (!text) {
    throw new Error("Empty response from decompose model");
  }

  const parsed = extractJsonFromText(text);
  if (!parsed) {
    throw new Error("Decompose model did not return valid JSON");
  }

  return {
    analysis: normalizeAnalysis(parsed),
    model,
    rawText: text,
  };
}
