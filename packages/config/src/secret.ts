import { inspect } from 'node:util';

const REDACTED = '[REDACTED]';

/**
 * Wraps a sensitive configuration value so it cannot be printed by accident
 * (logging, JSON serialization, string interpolation or util.inspect).
 * Call `reveal()` only at the point the raw value is handed to a client library.
 */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [inspect.custom](): string {
    return REDACTED;
  }
}
