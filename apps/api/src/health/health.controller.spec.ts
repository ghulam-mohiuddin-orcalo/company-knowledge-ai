import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DATABASE_POOL } from '../database/database.module.js';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  let app: INestApplication;
  let baseUrl: string;
  const query = vi.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: DATABASE_POOL, useValue: { query } }],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    query.mockReset();
  });

  it('GET /health is live without touching the database', async () => {
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(query).not.toHaveBeenCalled();
  });

  it('GET /ready is 200 when the database responds', async () => {
    query.mockResolvedValue({ rows: [{ '?column?': 1 }] });

    const response = await fetch(`${baseUrl}/ready`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      checks: { database: 'up' },
    });
  });

  it('GET /ready is 503 without error details when the database fails', async () => {
    query.mockRejectedValue(
      Object.assign(new Error('password authentication failed for user "x"'), {
        code: '28P01',
      }),
    );

    const response = await fetch(`${baseUrl}/ready`);
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(body)).toEqual({
      status: 'unavailable',
      checks: { database: 'down' },
    });
    expect(body).not.toContain('password');
  });

  it('GET /ready is 503 when the database does not answer in time', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    query.mockReturnValue(new Promise(() => undefined));

    const pending = fetch(`${baseUrl}/ready`);
    await vi.waitFor(() => expect(query).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(2000);
    const response = await pending;
    vi.useRealTimers();

    expect(response.status).toBe(503);
  });
});
