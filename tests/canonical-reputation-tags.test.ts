import { buildCanonicalTags, isCanonicalTag } from '../src/index.js';

describe('Canonical reputation tags', () => {
  it('[R23] builds canonical tags', () => {
    const out = buildCanonicalTags({
      dimension: 'security',
      signal: 'prompt_injection_detected',
    });
    expect(out.tag1).toBe('erc8004.v1/security');
    expect(out.tag2).toBe('erc8004.v1/prompt_injection_detected');
  });

  it('[R23] normalizes dimension/signal with trim/lowercase', () => {
    const out = buildCanonicalTags({
      dimension: 'quality',
      signal: '  SuCcEsS  ',
    } as any);
    expect(out).toEqual({
      tag1: 'erc8004.v1/quality',
      tag2: 'erc8004.v1/success',
    });
  });

  it('[R24] detects canonical tag namespace', () => {
    expect(isCanonicalTag('erc8004.v1/security')).toBe(true);
    expect(isCanonicalTag('enterprise')).toBe(false);
  });
});
