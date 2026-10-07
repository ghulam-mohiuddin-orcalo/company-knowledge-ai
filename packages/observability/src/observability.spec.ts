import { enrichLogContext, getLogContext, runWithContext } from './context.js';
import { JsonLogger, type LogLevel } from './json-logger.js';
import { redact } from './redact.js';

describe('redact (E8-T01)', () => {
  it.each([
    [
      'Authorization: Bearer abcdefghijklmnop.qrstu',
      'Authorization: Bearer [REDACTED]',
    ],
    [
      'token eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl here',
      'token [REDACTED_JWT] here',
    ],
    ['key sk-proj_ABCDEF1234567890 used', 'key [REDACTED_KEY] used'],
    [
      'postgresql://cka:SuperSecret@db:5432/app',
      'postgresql://cka:[REDACTED]@db:5432/app',
    ],
    ['password=hunter2&user=x', 'password=[REDACTED]&user=x'],
    ['{"client_secret": "abc123"}', '{"client_secret": "[REDACTED]"}'],
    ['api-key: XYZ987', 'api-key: [REDACTED]'],
  ])('masks %j', (input, expected) => {
    expect(redact(input)).toBe(expected);
  });

  it('leaves ordinary text alone', () => {
    const text = 'Ingestion succeeded: job 3f1b0c52 document 9a8b chunks 4';
    expect(redact(text)).toBe(text);
  });
});

describe('JsonLogger (E8-T01)', () => {
  const capture = (level: LogLevel = 'log') => {
    const lines: Array<Record<string, unknown>> = [];
    const logger = new JsonLogger(
      level,
      (line) => lines.push(JSON.parse(line)),
      'api',
    );
    return { logger, lines };
  };

  it('writes structured lines with correlation context', () => {
    const { logger, lines } = capture();

    runWithContext({ requestId: 'req_1' }, () => {
      enrichLogContext({ userId: 'u1', organizationId: 'o1' });
      logger.log('Document uploaded', 'DocumentsService');
    });

    expect(lines).toEqual([
      {
        time: expect.any(String),
        level: 'log',
        service: 'api',
        context: 'DocumentsService',
        msg: 'Document uploaded',
        requestId: 'req_1',
        userId: 'u1',
        organizationId: 'o1',
      },
    ]);
    expect(getLogContext()).toEqual({});
  });

  it('redacts messages and stacks', () => {
    const { logger, lines } = capture();

    logger.error(
      'failed with Bearer abcdefghijklmnopq',
      'Error: at sk-abcdefghijkl',
      'X',
    );

    expect(lines[0]).toMatchObject({
      msg: 'failed with Bearer [REDACTED]',
      stack: 'Error: at [REDACTED_KEY]',
      context: 'X',
    });
  });

  it('respects the configured level', () => {
    const { logger, lines } = capture('warn');

    logger.log('hidden');
    logger.debug('hidden');
    logger.warn('shown');
    logger.event('log', 'hidden', {});

    expect(lines.map((l) => l.msg)).toEqual(['shown']);
  });

  it('adds event fields', () => {
    const { logger, lines } = capture();

    runWithContext({ jobId: 'job_1' }, () =>
      logger.event('log', 'http_request', { status: 200, durationMs: 12 }),
    );

    expect(lines[0]).toMatchObject({
      msg: 'http_request',
      jobId: 'job_1',
      status: 200,
      durationMs: 12,
    });
  });
});
