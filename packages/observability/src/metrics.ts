/**
 * Minimal Prometheus text-format metrics (E8-T05). Dependency-free; label
 * values must be low-cardinality operational values — never tenant, user or
 * document identifiers, and never text from documents, questions or answers.
 */

type Labels = Record<string, string>;

/** Label names that would make metrics tenant- or content-identifying. */
const FORBIDDEN_LABELS =
  /^(organization|org|tenant|user|document|conversation|message|question|answer|content|text|filename)(_?id)?$/i;
const NAME = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const MAX_SERIES = 500;

function assertLabelNames(metric: string, names: readonly string[]): void {
  for (const name of names) {
    if (!NAME.test(name) || FORBIDDEN_LABELS.test(name)) {
      throw new Error(`Metric ${metric}: label "${name}" is not allowed`);
    }
  }
}

const escapeLabel = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');

function formatLabels(labels: Labels): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return '';
  return `{${entries.map(([k, v]) => `${k}="${escapeLabel(v)}"`).join(',')}}`;
}

const formatValue = (value: number) =>
  Number.isFinite(value) ? String(value) : value > 0 ? '+Inf' : '-Inf';

abstract class Metric<L extends string> {
  protected readonly series = new Map<
    string,
    { labels: Labels; value: number[] }
  >();

  constructor(
    readonly name: string,
    readonly help: string,
    readonly labelNames: readonly L[],
  ) {
    if (!NAME.test(name)) throw new Error(`Invalid metric name ${name}`);
    assertLabelNames(name, labelNames);
  }

  abstract readonly type: 'counter' | 'gauge' | 'histogram';
  abstract renderSeries(): string[];

  render(): string {
    return [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} ${this.type}`,
      ...this.renderSeries(),
    ].join('\n');
  }

  protected entry(
    labels: Partial<Record<L, string>>,
    size: number,
    overflow = false,
  ): number[] {
    const normalized: Labels = {};
    for (const name of this.labelNames) normalized[name] = labels[name] ?? '';
    const key = JSON.stringify(normalized);
    let entry = this.series.get(key);
    if (!entry) {
      // Bound memory if a label is ever fed unexpected values: further series
      // collapse into a single overflow series.
      if (this.series.size >= MAX_SERIES && !overflow) {
        const collapsed = Object.fromEntries(
          this.labelNames.map((name) => [name, 'other']),
        ) as Partial<Record<L, string>>;
        return this.entry(collapsed, size, true);
      }
      entry = { labels: normalized, value: new Array<number>(size).fill(0) };
      this.series.set(key, entry);
    }
    return entry.value;
  }
}

export class Counter<L extends string = never> extends Metric<L> {
  readonly type = 'counter';

  inc(labels: Partial<Record<L, string>> = {}, by = 1): void {
    if (by < 0 || !Number.isFinite(by)) return;
    this.entry(labels, 1)[0]! += by;
  }

  renderSeries(): string[] {
    return [...this.series.values()].map(
      (s) =>
        `${this.name}${formatLabels(s.labels)} ${formatValue(s.value[0]!)}`,
    );
  }
}

export class Gauge<L extends string = never> extends Metric<L> {
  readonly type = 'gauge';

  set(labels: Partial<Record<L, string>>, value: number): void {
    this.entry(labels, 1)[0] = value;
  }

  reset(): void {
    this.series.clear();
  }

  renderSeries(): string[] {
    return [...this.series.values()].map(
      (s) =>
        `${this.name}${formatLabels(s.labels)} ${formatValue(s.value[0]!)}`,
    );
  }
}

export const DEFAULT_SECONDS_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60,
];

export class Histogram<L extends string = never> extends Metric<L> {
  readonly type = 'histogram';

  constructor(
    name: string,
    help: string,
    labelNames: readonly L[],
    readonly buckets: readonly number[] = DEFAULT_SECONDS_BUCKETS,
  ) {
    super(name, help, labelNames);
    assertLabelNames(name, ['le']);
  }

  /** Layout: [bucket counts..., +Inf count, sum]. */
  observe(labels: Partial<Record<L, string>>, value: number): void {
    if (!Number.isFinite(value) || value < 0) return;
    const values = this.entry(labels, this.buckets.length + 2);
    this.buckets.forEach((bound, i) => {
      if (value <= bound) values[i]!++;
    });
    values[this.buckets.length]!++;
    values[this.buckets.length + 1]! += value;
  }

  renderSeries(): string[] {
    const lines: string[] = [];
    for (const { labels, value } of this.series.values()) {
      this.buckets.forEach((bound, i) =>
        lines.push(
          `${this.name}_bucket${formatLabels({ ...labels, le: String(bound) })} ${value[i]}`,
        ),
      );
      const count = value[this.buckets.length]!;
      lines.push(
        `${this.name}_bucket${formatLabels({ ...labels, le: '+Inf' })} ${count}`,
        `${this.name}_sum${formatLabels(labels)} ${formatValue(value[this.buckets.length + 1]!)}`,
        `${this.name}_count${formatLabels(labels)} ${count}`,
      );
    }
    return lines;
  }
}

/** A set of metrics rendered together in the Prometheus text format. */
export class MetricsRegistry {
  private readonly metrics = new Map<string, Metric<string>>();

  counter<L extends string = never>(
    name: string,
    help: string,
    labels: readonly L[] = [],
  ): Counter<L> {
    return this.register(new Counter<L>(name, help, labels));
  }

  gauge<L extends string = never>(
    name: string,
    help: string,
    labels: readonly L[] = [],
  ): Gauge<L> {
    return this.register(new Gauge<L>(name, help, labels));
  }

  histogram<L extends string = never>(
    name: string,
    help: string,
    labels: readonly L[] = [],
    buckets?: readonly number[],
  ): Histogram<L> {
    return this.register(new Histogram<L>(name, help, labels, buckets));
  }

  render(): string {
    return `${[...this.metrics.values()].map((m) => m.render()).join('\n')}\n`;
  }

  private register<M extends Metric<string>>(metric: M): M {
    if (this.metrics.has(metric.name)) {
      throw new Error(`Metric ${metric.name} is already registered`);
    }
    this.metrics.set(metric.name, metric);
    return metric;
  }
}

export const PROMETHEUS_CONTENT_TYPE =
  'text/plain; version=0.0.4; charset=utf-8';
