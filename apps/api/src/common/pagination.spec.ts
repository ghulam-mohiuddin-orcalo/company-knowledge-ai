import { encodeCursor, MAX_PAGE_SIZE, parsePageRequest } from './pagination.js';

describe('parsePageRequest', () => {
  it('defaults and parses limits', () => {
    expect(parsePageRequest({})).toEqual({ limit: 20 });
    expect(parsePageRequest({ limit: '5' })).toEqual({ limit: 5 });
  });

  it.each(['0', '-1', '101', '1.5', 'abc', '', '1e2'])(
    'rejects limit %j',
    (limit) => {
      expect(() => parsePageRequest({ limit })).toThrow(
        expect.objectContaining({ code: 'VALIDATION_FAILED' }),
      );
    },
  );

  it('rejects repeated parameters', () => {
    expect(() => parsePageRequest({ limit: ['1', '2'] })).toThrow();
  });

  it('round-trips cursors', () => {
    const item = {
      createdAt: new Date('2026-01-02T03:04:05.678Z'),
      id: '3f1b0c52-1f7e-4c2a-9a4e-0c1d2e3f4a5b',
    };

    expect(parsePageRequest({ cursor: encodeCursor(item) })).toEqual({
      limit: 20,
      after: item,
    });
    expect(MAX_PAGE_SIZE).toBe(100);
  });

  it.each([
    'garbage',
    Buffer.from('["2026-01-01", "not-a-uuid"]').toString('base64url'),
    Buffer.from('{"organizationId":"x"}').toString('base64url'),
    Buffer.from(
      '["x\' OR 1=1", "3f1b0c52-1f7e-4c2a-9a4e-0c1d2e3f4a5b"]',
    ).toString('base64url'),
  ])('rejects malformed cursor %j', (cursor) => {
    expect(() => parsePageRequest({ cursor })).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
  });
});
