export function parseJsonRecord(value: string | null | undefined): Record<string, unknown> {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function stringifyJsonRecord(value: Record<string, unknown> | null | undefined) {
  if (!value) {
    return null;
  }

  return JSON.stringify(value);
}
