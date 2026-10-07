import { isDatabaseUnavailableError } from './client.js';

const withCode = (code: string, message = 'x') =>
  Object.assign(new Error(message), { code });

describe('isDatabaseUnavailableError (E8-T06)', () => {
  it.each([
    ['connection refused', withCode('ECONNREFUSED')],
    ['connection reset', withCode('ECONNRESET')],
    ['server shutting down', withCode('57P01')],
    ['server starting up', withCode('57P03')],
    ['too many connections', withCode('53300')],
    ['connection exception class', withCode('08006')],
    ['terminated socket', new Error('Connection terminated unexpectedly')],
    [
      'pool connect timeout',
      new Error('timeout exceeded when trying to connect'),
    ],
    [
      'wrapped by the query builder',
      new Error('Failed query: select 1', { cause: withCode('ECONNREFUSED') }),
    ],
  ])('recognizes %s', (_, error) => {
    expect(isDatabaseUnavailableError(error)).toBe(true);
  });

  it.each([
    ['unique violation', withCode('23505')],
    ['syntax error', withCode('42601')],
    ['invalid input', withCode('22P02')],
    ['plain error', new Error('boom')],
    ['non-error', 'ECONNREFUSED'],
    ['undefined', undefined],
  ])('does not treat %s as an outage', (_, error) => {
    expect(isDatabaseUnavailableError(error)).toBe(false);
  });
});
