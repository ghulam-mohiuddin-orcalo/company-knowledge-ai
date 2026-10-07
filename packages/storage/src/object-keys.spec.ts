import { documentObjectKey } from './object-keys.js';

const ORG = 'aaaaaaaa-1111-4111-8111-bbbbbbbbbbbb';
const DOC = '22222222-2222-4222-8222-222222222222';

describe('documentObjectKey', () => {
  it('prefixes keys by tenant and document', () => {
    expect(documentObjectKey(ORG, DOC)).toBe(
      `org/${ORG}/documents/${DOC}/original`,
    );
  });

  it.each([
    ['../other-org', DOC],
    [ORG, '../../etc/passwd'],
    [ORG, 'invoice.pdf'],
    [`${ORG}/x`, DOC],
    [ORG.toUpperCase(), DOC],
    ['', DOC],
  ])('rejects non-UUID components (%s, %s)', (org, doc) => {
    expect(() => documentObjectKey(org, doc)).toThrow();
  });
});
