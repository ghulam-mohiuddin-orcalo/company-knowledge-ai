import { FixedWindowLimiter } from './fixed-window-limiter.js';

describe('FixedWindowLimiter (E8-T03)', () => {
  let now = 0;
  const limiter = () => new FixedWindowLimiter(60_000, () => now);

  beforeEach(() => {
    now = 1_000_000;
  });

  it('allows up to the limit per key, then refuses with a retry delay', () => {
    const l = limiter();

    expect([1, 2, 3].map(() => l.hit('a', 3).allowed)).toEqual([
      true,
      true,
      true,
    ]);
    now += 15_000;
    expect(l.hit('a', 3)).toEqual({ allowed: false, retryAfterSeconds: 45 });
    expect(l.hit('b', 3).allowed).toBe(true);
  });

  it('resets after the window', () => {
    const l = limiter();
    l.hit('a', 1);
    expect(l.hit('a', 1).allowed).toBe(false);

    now += 60_000;

    expect(l.hit('a', 1).allowed).toBe(true);
  });

  it('check() does not count', () => {
    const l = limiter();

    expect(l.check('a', 1).allowed).toBe(true);
    expect(l.check('a', 1).allowed).toBe(true);
    l.hit('a', 1);
    expect(l.check('a', 1).allowed).toBe(false);
  });
});
