function normalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeJsonValue(entry));
  }

  if (value && typeof value === 'object') {
    const normalized: Record<string, unknown> = {};
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record).sort()) {
      const entry = record[key];
      if (entry !== undefined) {
        normalized[key] = normalizeJsonValue(entry);
      }
    }
    return normalized;
  }

  return value;
}

export function stableJsonStringify(value: unknown): string {
  return JSON.stringify(normalizeJsonValue(value));
}
