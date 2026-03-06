import { describe, expect, it } from '@jest/globals';
import { transformRegistrationFile } from '../src/utils/index.js';

describe('Registration parsing backwards compatibility', () => {
  it('parses legacy `x402support` key (and prefers boolean value)', () => {
    const rawLegacy = {
      name: 'Agent',
      description: 'Desc',
      active: true,
      services: [],
      x402support: true,
    };

    const rf = transformRegistrationFile(rawLegacy);
    expect(rf.x402support).toBe(true);
  });
});
