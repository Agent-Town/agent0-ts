import { parseAgentId, parseFeedbackId } from '../src/utils/id-format';

describe('id-format', () => {
  it('parses internal AgentId format "chainId:tokenId"', () => {
    expect(parseAgentId('11155111:375')).toEqual({ chainId: 11155111, tokenId: 375 });
  });

  it('rejects CAIP-style "eip155:chainId:tokenId" (handled elsewhere)', () => {
    expect(() => parseAgentId('eip155:11155111:375')).toThrow();
  });

  it('rejects malformed numeric suffixes instead of truncating them', () => {
    expect(() => parseAgentId('11155111abc:375x')).toThrow();
  });

  it('rejects malformed feedback IDs instead of normalizing them', () => {
    expect(() => parseFeedbackId('11155111abc:375x:0x1234567890123456789012345678901234567890:1z')).toThrow();
  });
});

