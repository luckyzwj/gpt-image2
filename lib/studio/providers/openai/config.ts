const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_RESPONSES_MODEL = "gpt-5.4";

export type ResolvedProviderConfig = {
  apiKey: string;
  baseUrl: string;
  responsesModel: string;
  imageModel: string;
  source: "platform" | "byo";
};

export function getOpenAIImageProviderConfig() {
  return {
    apiKey: process.env.OPENAI_API_KEY || "",
    baseUrl: (process.env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, ""),
    responsesModel: process.env.OPENAI_RESPONSES_MODEL || DEFAULT_RESPONSES_MODEL,
    imageModel: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2",
  };
}

export function assertOpenAIImageProviderConfig() {
  const config = getOpenAIImageProviderConfig();
  if (!config.apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  return config;
}

export function buildResolvedProviderConfig(
  byo: { apiKey: string; baseUrl: string | null } | null,
): ResolvedProviderConfig {
  const platform = getOpenAIImageProviderConfig();
  if (byo) {
    return {
      apiKey: byo.apiKey,
      baseUrl: (byo.baseUrl || platform.baseUrl || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, ""),
      responsesModel: platform.responsesModel,
      imageModel: platform.imageModel,
      source: "byo",
    };
  }
  if (!platform.apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  return {
    apiKey: platform.apiKey,
    baseUrl: platform.baseUrl,
    responsesModel: platform.responsesModel,
    imageModel: platform.imageModel,
    source: "platform",
  };
}
