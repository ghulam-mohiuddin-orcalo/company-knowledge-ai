import { getLogContext } from './context.js';
import { redact } from './redact.js';

export type LogLevel = 'error' | 'warn' | 'log' | 'debug' | 'verbose';

const SEVERITY: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  log: 2,
  debug: 3,
  verbose: 4,
};

export type LogWriter = (line: string, level: LogLevel) => void;

const defaultWriter: LogWriter = (line, level) => {
  (level === 'error' || level === 'warn'
    ? process.stderr
    : process.stdout
  ).write(`${line}\n`);
};

/**
 * Structured JSON logger compatible with Nest's LoggerService. Each line holds
 * time, level, context, the (redacted) message and the current correlation
 * context (requestId/jobId, organization, user, document IDs).
 */
export class JsonLogger {
  private readonly threshold: number;

  constructor(
    level: LogLevel = 'log',
    private readonly write: LogWriter = defaultWriter,
    private readonly service?: string,
  ) {
    this.threshold = SEVERITY[level];
  }

  log(message: unknown, ...params: unknown[]): void {
    this.emit('log', message, params);
  }

  error(message: unknown, ...params: unknown[]): void {
    this.emit('error', message, params);
  }

  warn(message: unknown, ...params: unknown[]): void {
    this.emit('warn', message, params);
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.emit('debug', message, params);
  }

  verbose(message: unknown, ...params: unknown[]): void {
    this.emit('verbose', message, params);
  }

  /** A structured event (e.g. an HTTP access log) with extra fields. */
  event(
    level: LogLevel,
    message: string,
    fields: Record<string, unknown>,
  ): void {
    if (SEVERITY[level] > this.threshold) return;
    this.output(level, message, undefined, undefined, fields);
  }

  private emit(level: LogLevel, message: unknown, params: unknown[]): void {
    if (SEVERITY[level] > this.threshold) return;
    // Nest passes (message, context) or, for errors, (message, stack, context).
    const context =
      typeof params.at(-1) === 'string' ? (params.at(-1) as string) : undefined;
    const stack =
      level === 'error' && params.length > 1 && typeof params[0] === 'string'
        ? (params[0] as string)
        : undefined;
    this.output(level, message, context, stack);
  }

  private output(
    level: LogLevel,
    message: unknown,
    context: string | undefined,
    stack: string | undefined,
    fields: Record<string, unknown> = {},
  ): void {
    const text =
      message instanceof Error
        ? message.message
        : typeof message === 'string'
          ? message
          : JSON.stringify(message);
    const entry: Record<string, unknown> = {
      time: new Date().toISOString(),
      level,
      ...(this.service ? { service: this.service } : {}),
      ...(context ? { context } : {}),
      msg: redact(text ?? ''),
      ...getLogContext(),
      ...fields,
    };
    if (stack) entry.stack = redact(stack);
    this.write(JSON.stringify(entry), level);
  }
}
