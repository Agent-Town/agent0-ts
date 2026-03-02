const REQUIREMENTS = Array.from({ length: 34 }, (_, i) => `R${i + 1}`);

const COVERAGE_MAP: Record<string, string[]> = {
  R1: ['entity-types:R1'],
  R2: ['entity-types:R2'],
  R3: ['entity-types:R3'],
  R4: ['entity-types:R4'],
  R5: ['entity-types:R5'],
  R6: ['entity-types:R6'],
  R7: ['registration-json-extensions:R7'],
  R8: ['registration-json-extensions:R8'],
  R9: ['registration-json-extensions:R9'],
  R10: ['registration-json-extensions:R10'],
  R11: ['registration-json-extensions:R11'],
  R12: ['permission-manifest:R12'],
  R13: ['permission-manifest:R13'],
  R14: ['permission-manifest:R14'],
  R15: ['permission-manifest:R15'],
  R16: ['permission-manifest:R16'],
  R17: ['permission-manifest:R17'],
  R18: ['permission-manifest:R18'],
  R19: ['permission-manifest:R19'],
  R20: ['permission-manifest:R20'],
  R21: ['permission-manifest-ref:R21'],
  R22: ['permission-manifest-ref:R22'],
  R23: ['canonical-reputation-tags:R23'],
  R24: ['canonical-reputation-tags:R24'],
  R25: ['entity-type-search:R25'],
  R26: ['entity-type-search:R26'],
  R27: ['entity-type-search:R27'],
  R28: ['entity-type-search:R28'],
  R29: ['entity-type-search:R29'],
  R30: ['backwards-compatibility:R30'],
  R31: ['backwards-compatibility:R31'],
  R32: ['public-api-exports:R32'],
  R33: ['http-ipfs-registration-parity:R33'],
  R34: ['backwards-compatibility:R34'],
};

describe('Spec traceability R1..R34', () => {
  it('[All] every requirement has at least one mapped test', () => {
    for (const requirement of REQUIREMENTS) {
      expect(COVERAGE_MAP[requirement]).toBeDefined();
      expect(Array.isArray(COVERAGE_MAP[requirement])).toBe(true);
      expect(COVERAGE_MAP[requirement].length).toBeGreaterThan(0);
    }
  });

  it('[All] coverage map contains no unknown requirement IDs', () => {
    const known = new Set(REQUIREMENTS);
    for (const key of Object.keys(COVERAGE_MAP)) {
      expect(known.has(key)).toBe(true);
    }
  });

  it('[All] requirements list has exactly R1..R34', () => {
    expect(REQUIREMENTS[0]).toBe('R1');
    expect(REQUIREMENTS[REQUIREMENTS.length - 1]).toBe('R34');
    expect(REQUIREMENTS.length).toBe(34);
  });
});
