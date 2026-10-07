import { safeReturnTo } from './auth';

describe('safeReturnTo', () => {
  it.each([
    ['/app/documents', '/app/documents'],
    ['//evil.example/path', '/app'],
    ['https://evil.example', '/app'],
    ['javascript:alert(1)', '/app'],
    [undefined, '/app'],
  ])('%s -> %s', (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });
});
