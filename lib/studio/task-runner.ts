import { randomUUID } from "crypto";
import { createStudioAsset } from "@/lib/studio/asset-service";
import { generateStudioImage } from "@/lib/studio/providers/openai/responses-image";
import { decomposeStudioImage, type DecomposeDepth } from "@/lib/studio/providers/openai/decompose";
import { buildResolvedProviderConfig, type ResolvedProviderConfig } from "@/lib/studio/providers/openai/config";
import { getDecryptedUserApiKey } from "@/lib/studio/providers/openai/user-api-key-service";
import { claimQueuedStudioTasks, appendStudioTaskEvent, markStudioTaskCompleted, markStudioTaskFailed } from "@/lib/studio/task-service";
import { uploadBase64Asset } from "@/lib/storage/legacy";
import type { StudioTaskType } from "@/lib/studio/domain/types";

async function resolveProviderForUser(userId: string): Promise<ResolvedProviderConfig> {
  const byo = await getDecryptedUserApiKey(userId, "openai");
  return buildResolvedProviderConfig(byo ? { apiKey: byo.apiKey, baseUrl: byo.baseUrl } : null);
}

function toStringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(item => String(item)).filter(Boolean) : [];
}

function toPositiveNumber(value: unknown, fallback: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sanitizeImageFormat(value: unknown): "png" | "jpeg" | "webp" {
  const format = String(value || "png").toLowerCase();
  if (format === "jpg" || format === "jpeg") {
    return "jpeg";
  }
  if (format === "webp") {
    return "webp";
  }
  return "png";
}

function buildCreationPrompts({
  productName,
  productDescription,
  sellingPoints,
  imageCount,
}: {
  productName: string;
  productDescription: string;
  sellingPoints: string[];
  imageCount: number;
}) {
  const fallbackSellingPoint = "high quality";
  const points = sellingPoints.length > 0 ? sellingPoints : [fallbackSellingPoint];

  return Array.from({ length: imageCount }).map((_, index) => {
    const point = points[index % points.length];
    return `Create a clean ecommerce marketing image for ${productName}. Product details: ${productDescription}. Focus point: ${point}. Variant ${index + 1}.`;
  });
}

type ArticleSlot = {
  position: string;
  prompt: string;
  suggestedCaption: string;
};

function buildArticleSlots({
  title,
  body,
  imageCount,
  style,
}: {
  title: string;
  body: string;
  imageCount: number;
  style: string;
}): ArticleSlot[] {
  const positions: string[] = [];
  if (imageCount <= 0) return [];
  positions.push("hero");
  for (let i = positions.length; i < imageCount; i += 1) {
    if (i === imageCount - 1 && imageCount > 1) {
      positions.push("conclusion");
    } else {
      positions.push(`section_${positions.length}`);
    }
  }

  const bodyExcerpt = body.slice(0, 200);
  const styleHint = style ? ` Visual style: ${style}.` : "";

  return positions.map((position, index) => ({
    position,
    prompt: `Editorial illustration for the article "${title}", representing the ${position.replace(/_/g, " ")} section.${bodyExcerpt ? ` Context: ${bodyExcerpt}` : ""}${styleHint} Variant ${index + 1}.`,
    suggestedCaption: position === "hero" ? title : `${title} — ${position.replace(/_/g, " ")}`,
  }));
}

type PptSlide = {
  index: number;
  title: string;
  bullets: string[];
  imagePrompt: string;
};

function buildPptSlides({
  topic,
  pageCount,
  audience,
  style,
}: {
  topic: string;
  pageCount: number;
  audience: string;
  style: string;
}): PptSlide[] {
  if (pageCount <= 0) return [];
  const slides: PptSlide[] = [];
  const audienceHint = audience ? ` for ${audience}` : "";
  const styleHint = style ? ` Visual style: ${style}.` : "";

  for (let i = 0; i < pageCount; i += 1) {
    let slideTitle: string;
    let bullets: string[];

    if (i === 0) {
      slideTitle = topic;
      bullets = ["Overview", "Why it matters", "What we'll cover"];
    } else if (i === pageCount - 1 && pageCount > 1) {
      slideTitle = `Summary: ${topic}`;
      bullets = ["Key takeaways", "Next steps", "Q&A"];
    } else {
      slideTitle = `${topic} — Part ${i}`;
      bullets = [`Point ${i}.1`, `Point ${i}.2`, `Point ${i}.3`];
    }

    slides.push({
      index: i,
      title: slideTitle,
      bullets,
      imagePrompt: `Presentation slide cover image about "${slideTitle}"${audienceHint}.${styleHint} Slide ${i + 1} of ${pageCount}.`,
    });
  }
  return slides;
}

async function runImageSingleTask(task: {
  id: string;
  userId: string;
  creditsReserved: number;
  request: Record<string, unknown>;
}) {
  const prompt = toStringValue(task.request.prompt);
  const size = toStringValue(task.request.size) || "1024x1024";
  const quality = (toStringValue(task.request.quality) || "high") as "low" | "medium" | "high" | "auto";
  const format = sanitizeImageFormat(task.request.format);

  const referenceImagesRaw = task.request.referenceImages;
  const referenceImages = Array.isArray(referenceImagesRaw)
    ? referenceImagesRaw
        .map(item => (item && typeof item === "object" ? item : null))
        .filter(Boolean)
        .map(item => {
          const record = item as Record<string, unknown>;
          return {
            base64: toStringValue(record.base64),
            mimeType: toStringValue(record.mimeType) || "image/png",
            label: toStringValue(record.label),
          };
        })
        .filter(item => item.base64.length > 0)
    : [];

  await appendStudioTaskEvent(task.id, {
    eventType: "image_generation_started",
    progress: 15,
  });

  const providerConfig = await resolveProviderForUser(task.userId);
  const generated = await generateStudioImage({
    prompt,
    size,
    quality,
    format,
    referenceImages,
    providerConfig,
  });

  await appendStudioTaskEvent(task.id, {
    eventType: "image_generation_uploaded",
    progress: 70,
  });

  const uploaded = await uploadBase64Asset({
    base64: generated.imageBase64,
    userId: task.userId,
    kind: "image",
    format,
  });

  const assetId = await createStudioAsset({
    taskId: task.id,
    userId: task.userId,
    assetType: "image",
    publicUrl: uploaded.publicUrl,
    storageKey: uploaded.storageKey,
    mimeType: uploaded.mimeType,
    sizeBytes: uploaded.sizeBytes,
    metadata: {
      format,
      model: generated.model,
    },
  });

  await markStudioTaskCompleted({
    taskId: task.id,
    creditsFinal: task.creditsReserved,
    resultPayload: {
      assets: [
        {
          id: assetId,
          url: uploaded.publicUrl,
          storageKey: uploaded.storageKey,
          mimeType: uploaded.mimeType,
        },
      ],
      model: generated.model,
      format,
    },
  });
}

async function runImageDecomposeTask(task: {
  id: string;
  userId: string;
  creditsReserved: number;
  request: Record<string, unknown>;
}) {
  const imageBase64 = toStringValue(task.request.imageBase64);
  const mimeType = toStringValue(task.request.mimeType) || "image/png";
  const depthRaw = toStringValue(task.request.depth) || "detailed";
  const depth: DecomposeDepth = depthRaw === "brief" ? "brief" : "detailed";
  const locale = toStringValue(task.request.locale) || "zh";

  if (!imageBase64) {
    throw new Error("imageBase64 is required for decompose task");
  }

  await appendStudioTaskEvent(task.id, {
    eventType: "image_decompose_started",
    progress: 20,
  });

  const providerConfig = await resolveProviderForUser(task.userId);
  const result = await decomposeStudioImage({
    imageBase64,
    mimeType,
    depth,
    locale,
    providerConfig,
  });

  await appendStudioTaskEvent(task.id, {
    eventType: "image_decompose_completed",
    progress: 90,
  });

  await markStudioTaskCompleted({
    taskId: task.id,
    creditsFinal: task.creditsReserved,
    resultPayload: {
      analysis: result.analysis,
      model: result.model,
      depth,
      locale,
    },
  });
}

async function runCreationPlanTask(task: {
  id: string;
  creditsReserved: number;
  request: Record<string, unknown>;
}) {
  const productName = toStringValue(task.request.productName) || "Unnamed Product";
  const productDescription = toStringValue(task.request.productDescription);
  const sellingPoints = toStringArray(task.request.sellingPoints);
  const imageCount = Math.min(12, Math.max(1, toPositiveNumber(task.request.imageCount, 4)));

  await appendStudioTaskEvent(task.id, {
    eventType: "creation_plan_started",
    progress: 20,
  });

  const prompts = buildCreationPrompts({
    productName,
    productDescription,
    sellingPoints,
    imageCount,
  });

  await markStudioTaskCompleted({
    taskId: task.id,
    creditsFinal: 0,
    resultPayload: {
      planId: randomUUID(),
      productName,
      imageCount,
      prompts,
      generatedAt: new Date().toISOString(),
    },
  });
}

async function runCreationGenerateTask(task: {
  id: string;
  userId: string;
  creditsReserved: number;
  request: Record<string, unknown>;
}) {
  const productName = toStringValue(task.request.productName) || "Unnamed Product";
  const prompts = toStringArray(task.request.prompts);
  const imageCount = Math.min(12, Math.max(1, prompts.length || toPositiveNumber(task.request.imageCount, 4)));
  const format = sanitizeImageFormat(task.request.format);
  const size = toStringValue(task.request.size) || "1024x1024";

  const finalPrompts = prompts.length > 0 ? prompts.slice(0, imageCount) : buildCreationPrompts({
    productName,
    productDescription: toStringValue(task.request.productDescription),
    sellingPoints: toStringArray(task.request.sellingPoints),
    imageCount,
  });

  const assets: Array<{ id: string; url: string; prompt: string }> = [];
  const errors: Array<{ index: number; prompt: string; error: string }> = [];

  const providerConfig = await resolveProviderForUser(task.userId);

  for (let index = 0; index < finalPrompts.length; index += 1) {
    const prompt = finalPrompts[index];

    try {
      await appendStudioTaskEvent(task.id, {
        eventType: "creation_item_started",
        progress: Math.floor((index / finalPrompts.length) * 100),
        payload: { index, prompt },
      });

      const generated = await generateStudioImage({
        prompt,
        size,
        quality: "high",
        format,
        providerConfig,
      });
      const uploaded = await uploadBase64Asset({
        base64: generated.imageBase64,
        userId: task.userId,
        kind: "image",
        format,
      });

      const assetId = await createStudioAsset({
        taskId: task.id,
        userId: task.userId,
        assetType: "image",
        publicUrl: uploaded.publicUrl,
        storageKey: uploaded.storageKey,
        mimeType: uploaded.mimeType,
        sizeBytes: uploaded.sizeBytes,
        metadata: {
          productName,
          prompt,
          itemIndex: index,
        },
      });

      assets.push({
        id: assetId,
        url: uploaded.publicUrl,
        prompt,
      });
    } catch (error) {
      errors.push({
        index,
        prompt,
        error: error instanceof Error ? error.message : "Unknown generation error",
      });
    }
  }

  const succeededCount = assets.length;
  const creditsPerItem = finalPrompts.length > 0 ? Math.floor(task.creditsReserved / finalPrompts.length) : 0;
  const creditsFinal = creditsPerItem * succeededCount;

  await markStudioTaskCompleted({
    taskId: task.id,
    creditsFinal,
    status: errors.length > 0 ? "partial_failed" : "completed",
    resultPayload: {
      productName,
      succeededCount,
      failedCount: errors.length,
      assets,
      errors,
    },
  });
}

async function runArticlePlanTask(task: {
  id: string;
  request: Record<string, unknown>;
}) {
  const title = toStringValue(task.request.title) || "Untitled article";
  const body = toStringValue(task.request.body);
  const style = toStringValue(task.request.style);
  const imageCount = Math.min(20, Math.max(1, toPositiveNumber(task.request.imageCount, 4)));

  await appendStudioTaskEvent(task.id, {
    eventType: "article_plan_started",
    progress: 20,
  });

  const slots = buildArticleSlots({ title, body, imageCount, style });

  await markStudioTaskCompleted({
    taskId: task.id,
    creditsFinal: 0,
    resultPayload: {
      planId: randomUUID(),
      title,
      imageCount,
      slots,
      generatedAt: new Date().toISOString(),
    },
  });
}

async function runArticleGenerateTask(task: {
  id: string;
  userId: string;
  creditsReserved: number;
  request: Record<string, unknown>;
}) {
  const title = toStringValue(task.request.title) || "Untitled article";
  const body = toStringValue(task.request.body);
  const style = toStringValue(task.request.style);
  const explicitPrompts = toStringArray(task.request.prompts);
  const imageCount = Math.min(
    20,
    Math.max(1, explicitPrompts.length || toPositiveNumber(task.request.imageCount, 4)),
  );
  const format = sanitizeImageFormat(task.request.format);
  const size = toStringValue(task.request.size) || "1024x1024";

  const slots: ArticleSlot[] =
    explicitPrompts.length > 0
      ? explicitPrompts.slice(0, imageCount).map((prompt, index) => ({
          position: `slot_${index + 1}`,
          prompt,
          suggestedCaption: `${title} — ${index + 1}`,
        }))
      : buildArticleSlots({ title, body, imageCount, style });

  const assets: Array<{ id: string; url: string; prompt: string; position: string }> = [];
  const errors: Array<{ index: number; prompt: string; error: string }> = [];

  const providerConfig = await resolveProviderForUser(task.userId);

  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];

    try {
      await appendStudioTaskEvent(task.id, {
        eventType: "article_item_started",
        progress: Math.floor((index / slots.length) * 100),
        payload: { index, position: slot.position, prompt: slot.prompt },
      });

      const generated = await generateStudioImage({
        prompt: slot.prompt,
        size,
        quality: "high",
        format,
        providerConfig,
      });
      const uploaded = await uploadBase64Asset({
        base64: generated.imageBase64,
        userId: task.userId,
        kind: "image",
        format,
      });

      const assetId = await createStudioAsset({
        taskId: task.id,
        userId: task.userId,
        assetType: "image",
        publicUrl: uploaded.publicUrl,
        storageKey: uploaded.storageKey,
        mimeType: uploaded.mimeType,
        sizeBytes: uploaded.sizeBytes,
        metadata: {
          title,
          position: slot.position,
          prompt: slot.prompt,
          caption: slot.suggestedCaption,
          itemIndex: index,
        },
      });

      assets.push({
        id: assetId,
        url: uploaded.publicUrl,
        prompt: slot.prompt,
        position: slot.position,
      });
    } catch (error) {
      errors.push({
        index,
        prompt: slot.prompt,
        error: error instanceof Error ? error.message : "Unknown generation error",
      });
    }
  }

  const succeededCount = assets.length;
  const creditsPerItem = slots.length > 0 ? Math.floor(task.creditsReserved / slots.length) : 0;
  const creditsFinal = creditsPerItem * succeededCount;

  await markStudioTaskCompleted({
    taskId: task.id,
    creditsFinal,
    status: errors.length > 0 ? "partial_failed" : "completed",
    resultPayload: {
      title,
      succeededCount,
      failedCount: errors.length,
      assets,
      errors,
    },
  });
}

async function runPptPlanTask(task: {
  id: string;
  request: Record<string, unknown>;
}) {
  const topic = toStringValue(task.request.topic) || "Untitled deck";
  const audience = toStringValue(task.request.audience);
  const style = toStringValue(task.request.style);
  const pageCount = Math.min(20, Math.max(1, toPositiveNumber(task.request.pageCount, 8)));

  await appendStudioTaskEvent(task.id, {
    eventType: "ppt_plan_started",
    progress: 20,
  });

  const slides = buildPptSlides({ topic, pageCount, audience, style });

  await markStudioTaskCompleted({
    taskId: task.id,
    creditsFinal: 0,
    resultPayload: {
      planId: randomUUID(),
      topic,
      pageCount,
      slides,
      generatedAt: new Date().toISOString(),
    },
  });
}

async function runPptGenerateTask(task: {
  id: string;
  userId: string;
  creditsReserved: number;
  request: Record<string, unknown>;
}) {
  const topic = toStringValue(task.request.topic) || "Untitled deck";
  const audience = toStringValue(task.request.audience);
  const style = toStringValue(task.request.style);
  const slidesFromRequest = Array.isArray(task.request.slides) ? (task.request.slides as Array<Record<string, unknown>>) : [];
  const explicitPageCount = toPositiveNumber(task.request.pageCount, 8);
  const pageCount = Math.min(
    20,
    Math.max(1, slidesFromRequest.length || explicitPageCount),
  );
  const format = sanitizeImageFormat(task.request.format);
  const size = toStringValue(task.request.size) || "1024x1024";

  const slides: PptSlide[] =
    slidesFromRequest.length > 0
      ? slidesFromRequest.slice(0, pageCount).map((raw, index) => ({
          index,
          title: toStringValue(raw.title) || `Slide ${index + 1}`,
          bullets: toStringArray(raw.bullets),
          imagePrompt:
            toStringValue(raw.imagePrompt) ||
            `Presentation slide cover image about "${toStringValue(raw.title) || topic}". Slide ${index + 1} of ${pageCount}.`,
        }))
      : buildPptSlides({ topic, pageCount, audience, style });

  const assets: Array<{ id: string; url: string; slideIndex: number; title: string; prompt: string }> = [];
  const errors: Array<{ index: number; prompt: string; error: string }> = [];

  const providerConfig = await resolveProviderForUser(task.userId);

  for (let index = 0; index < slides.length; index += 1) {
    const slide = slides[index];

    try {
      await appendStudioTaskEvent(task.id, {
        eventType: "ppt_slide_started",
        progress: Math.floor((index / slides.length) * 100),
        payload: { index, title: slide.title, prompt: slide.imagePrompt },
      });

      const generated = await generateStudioImage({
        prompt: slide.imagePrompt,
        size,
        quality: "high",
        format,
        providerConfig,
      });
      const uploaded = await uploadBase64Asset({
        base64: generated.imageBase64,
        userId: task.userId,
        kind: "image",
        format,
      });

      const assetId = await createStudioAsset({
        taskId: task.id,
        userId: task.userId,
        assetType: "image",
        publicUrl: uploaded.publicUrl,
        storageKey: uploaded.storageKey,
        mimeType: uploaded.mimeType,
        sizeBytes: uploaded.sizeBytes,
        metadata: {
          topic,
          slideIndex: index,
          slideTitle: slide.title,
          bullets: slide.bullets,
          prompt: slide.imagePrompt,
        },
      });

      assets.push({
        id: assetId,
        url: uploaded.publicUrl,
        slideIndex: index,
        title: slide.title,
        prompt: slide.imagePrompt,
      });
    } catch (error) {
      errors.push({
        index,
        prompt: slide.imagePrompt,
        error: error instanceof Error ? error.message : "Unknown generation error",
      });
    }
  }

  const succeededCount = assets.length;
  const creditsPerItem = slides.length > 0 ? Math.floor(task.creditsReserved / slides.length) : 0;
  const creditsFinal = creditsPerItem * succeededCount;

  await markStudioTaskCompleted({
    taskId: task.id,
    creditsFinal,
    status: errors.length > 0 ? "partial_failed" : "completed",
    resultPayload: {
      topic,
      succeededCount,
      failedCount: errors.length,
      assets,
      errors,
    },
  });
}

async function runTaskByType(task: {
  id: string;
  userId: string;
  taskType: string;
  creditsReserved: number;
  request: Record<string, unknown>;
}) {
  const taskType = task.taskType as StudioTaskType;

  switch (taskType) {
    case "image_single":
      await runImageSingleTask(task);
      return;
    case "image_decompose":
      await runImageDecomposeTask(task);
      return;
    case "creation_plan":
      await runCreationPlanTask(task);
      return;
    case "creation_generate":
      await runCreationGenerateTask(task);
      return;
    case "article_plan":
      await runArticlePlanTask(task);
      return;
    case "article_generate":
      await runArticleGenerateTask(task);
      return;
    case "ppt_plan":
      await runPptPlanTask(task);
      return;
    case "ppt_generate":
      await runPptGenerateTask(task);
      return;
    default:
      throw new Error(`Unsupported studio task type: ${task.taskType}`);
  }
}

export async function runQueuedStudioTasks(limit = 2) {
  const claimed = await claimQueuedStudioTasks(limit);
  if (claimed.length === 0) {
    return {
      claimed: 0,
      completed: 0,
      failed: 0,
      taskIds: [] as string[],
    };
  }

  let completed = 0;
  let failed = 0;

  for (const task of claimed) {
    try {
      await appendStudioTaskEvent(task.id, {
        eventType: "task_claimed_for_execution",
        progress: 1,
      });
      await runTaskByType(task);
      completed += 1;
    } catch (error) {
      failed += 1;
      await markStudioTaskFailed({
        taskId: task.id,
        errorCode: "runner_error",
        errorMessage: error instanceof Error ? error.message : "Unknown runner error",
      });
    }
  }

  return {
    claimed: claimed.length,
    completed,
    failed,
    taskIds: claimed.map(task => task.id),
  };
}
