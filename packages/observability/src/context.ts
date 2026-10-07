import { AsyncLocalStorage } from 'node:async_hooks';

/** Correlation identifiers carried through a request or background job. */
export interface LogContext {
  requestId?: string;
  jobId?: string;
  organizationId?: string;
  userId?: string;
  documentId?: string;
}

const storage = new AsyncLocalStorage<LogContext>();

/** Runs `fn` with a fresh correlation context (nested contexts inherit fields). */
export function runWithContext<T>(context: LogContext, fn: () => T): T {
  return storage.run({ ...storage.getStore(), ...context }, fn);
}

export function getLogContext(): LogContext {
  return storage.getStore() ?? {};
}

/** Adds fields to the current context (e.g. the user once authenticated). */
export function enrichLogContext(fields: LogContext): void {
  const store = storage.getStore();
  if (store) Object.assign(store, fields);
}
