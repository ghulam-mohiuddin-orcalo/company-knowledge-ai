'use client';

import type { DocumentStatus } from '@cka/contracts';
import { type ReactNode, useEffect, useRef } from 'react';
import { ApiRequestError } from '@/lib/api-client';

/** User-facing message for an API error; never shows internal details. */
export function describeError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 429) {
      return 'Too many requests. Please wait a moment and try again.';
    }
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}

export function Alert({
  kind = 'error',
  children,
}: {
  kind?: 'error' | 'info';
  children: ReactNode;
}) {
  return (
    <div
      className={`alert ${kind}`}
      role={kind === 'error' ? 'alert' : 'status'}
    >
      {children}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p role="status" aria-live="polite">
      {label}
    </p>
  );
}

const STATUS_LABELS: Record<DocumentStatus, [string, string]> = {
  QUEUED: ['Queued', 'pending'],
  PROCESSING: ['Processing', 'pending'],
  READY: ['Ready', 'ready'],
  FAILED: ['Failed', 'failed'],
  DELETING: ['Deleting', 'pending'],
  DELETED: ['Deleted', 'failed'],
};

export function StatusBadge({ status }: { status: DocumentStatus }) {
  const [label, tone] = STATUS_LABELS[status];
  return <span className={`badge ${tone}`}>{label}</span>;
}

/**
 * Accessible modal dialog: focus moves inside on open, Escape closes, focus
 * returns to the opener on close.
 */
export function Dialog({
  title,
  onClose,
  children,
  variant = 'drawer',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  variant?: 'drawer' | 'centered';
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Callers pass inline handlers; keep the latest without re-running the
  // effect, which would steal focus back on every parent re-render.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current();
      if (event.key === 'Tab' && ref.current) {
        // Keep focus inside the dialog.
        const focusable = ref.current.querySelectorAll<HTMLElement>(
          'button, a[href], input, textarea, select, [tabindex="0"]',
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, []);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        ref={ref}
        className={`dialog ${variant === 'centered' ? 'centered' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** Human description of a page/section locator. */
export function describeLocator(locator: {
  page: number | null;
  section: string | null;
}): string {
  if (locator.page !== null) return `Page ${locator.page}`;
  if (locator.section !== null) return `Section: ${locator.section}`;
  return 'Document';
}
