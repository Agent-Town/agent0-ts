export type CanonicalDimension =
  | 'quality'
  | 'reliability'
  | 'security'
  | 'privacy'
  | 'compliance'
  | 'economics'
  | 'ux';

function normalizeSegment(segment: string): string {
  return segment.trim().toLowerCase();
}

export function buildCanonicalTags(input: {
  dimension: CanonicalDimension;
  signal: string;
}): { tag1: string; tag2: string } {
  const dimension = normalizeSegment(input.dimension);
  const signal = normalizeSegment(input.signal);
  return {
    tag1: `erc8004.v1/${dimension}`,
    tag2: `erc8004.v1/${signal}`,
  };
}

export function isCanonicalTag(tag: string): boolean {
  return /^erc8004\.v1\/[^/\s]+$/.test(tag.trim());
}
