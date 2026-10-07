import { MetricsRegistry } from './metrics.js';

describe('MetricsRegistry (E8-T05)', () => {
  it('renders counters, gauges and histograms in Prometheus text format', () => {
    const registry = new MetricsRegistry();
    const requests = registry.counter('cka_requests_total', 'Requests.', [
      'route',
      'status',
    ]);
    const queued = registry.gauge('cka_jobs', 'Jobs.', ['status']);
    const latency = registry.histogram(
      'cka_latency_seconds',
      'Latency.',
      [],
      [0.1, 1],
    );

    requests.inc({ route: '/v1/me', status: '200' });
    requests.inc({ route: '/v1/me', status: '200' });
    queued.set({ status: 'QUEUED' }, 3);
    latency.observe({}, 0.05);
    latency.observe({}, 0.5);
    latency.observe({}, 5);

    expect(registry.render()).toBe(
      [
        '# HELP cka_requests_total Requests.',
        '# TYPE cka_requests_total counter',
        'cka_requests_total{route="/v1/me",status="200"} 2',
        '# HELP cka_jobs Jobs.',
        '# TYPE cka_jobs gauge',
        'cka_jobs{status="QUEUED"} 3',
        '# HELP cka_latency_seconds Latency.',
        '# TYPE cka_latency_seconds histogram',
        'cka_latency_seconds_bucket{le="0.1"} 1',
        'cka_latency_seconds_bucket{le="1"} 2',
        'cka_latency_seconds_bucket{le="+Inf"} 3',
        'cka_latency_seconds_sum 5.55',
        'cka_latency_seconds_count 3',
        '',
      ].join('\n'),
    );
  });

  it.each([
    'organization_id',
    'tenant',
    'userId',
    'document',
    'question',
    'content',
  ])('refuses identifying or content label %j', (label) => {
    expect(() =>
      new MetricsRegistry().counter('cka_x_total', 'X.', [label]),
    ).toThrow(/not allowed/);
  });

  it('escapes label values and bounds series cardinality', () => {
    const registry = new MetricsRegistry();
    const counter = registry.counter('cka_c_total', 'C.', ['code']);
    counter.inc({ code: 'a"b\\c\nd' });
    for (let i = 0; i < 600; i++) counter.inc({ code: `code-${i}` });

    const output = registry.render();
    expect(output).toContain('cka_c_total{code="a\\"b\\\\c\\nd"} 1');
    expect(
      output.split('\n').filter((l) => l.startsWith('cka_c_total')).length,
    ).toBe(501);
    expect(output).toContain('cka_c_total{code="other"} 101');
  });

  it('refuses duplicate metric names', () => {
    const registry = new MetricsRegistry();
    registry.counter('cka_dup_total', 'D.');
    expect(() => registry.counter('cka_dup_total', 'D.')).toThrow(/already/);
  });
});
