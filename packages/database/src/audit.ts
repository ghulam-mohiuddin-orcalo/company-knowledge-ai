import { auditEvents } from './schema.js';
import type { Database } from './client.js';

export type AuditAction =
  | 'USER_PROVISIONED'
  | 'DOCUMENT_UPLOADED'
  | 'DOCUMENT_DELETED'
  | 'INGESTION_SUCCEEDED'
  | 'INGESTION_FAILED'
  | 'PLATFORM_ORGANIZATIONS_LISTED';

export interface AuditEvent {
  action: AuditAction;
  organizationId: string | null;
  actorUserId: string | null;
  targetType: 'user' | 'document' | 'organization';
  targetId: string | null;
  /** Identifiers, codes and counts only: never text, filenames or secrets. */
  metadata?: Record<string, string | number | boolean | null>;
  requestId?: string | null;
}

type Executor = Pick<Database, 'insert'>;

/** Records an audit event, ideally inside the transaction of the audited action. */
export async function recordAuditEvent(
  executor: Executor,
  event: AuditEvent,
): Promise<void> {
  await executor.insert(auditEvents).values({
    action: event.action,
    organizationId: event.organizationId,
    actorUserId: event.actorUserId,
    targetType: event.targetType,
    targetId: event.targetId,
    metadata: event.metadata ?? {},
    requestId: event.requestId ?? null,
  });
}
