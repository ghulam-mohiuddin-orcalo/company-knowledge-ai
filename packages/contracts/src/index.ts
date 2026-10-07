// Shared API contract types: the only coupling between apps/web and apps/api.
// Response shapes only; never export ORM entities or backend-internal types.

/** Error envelope returned for every failed request (TDD §19.1). */
export interface ErrorEnvelope {
  error: { code: string; message: string; requestId?: string };
}

export type MembershipRole = 'MEMBER' | 'ORG_ADMIN';
export type OrganizationStatus = 'ACTIVE' | 'SUSPENDED';

export interface MeResponse {
  user: {
    id: string;
    email: string;
    displayName: string | null;
    isPlatformAdmin: boolean;
  };
  activeOrganization: {
    id: string;
    name: string;
    membershipId: string;
    role: MembershipRole;
  } | null;
  /** The caller's own memberships (for organization selection). */
  organizations: Array<{
    id: string;
    name: string;
    role: MembershipRole;
    status: OrganizationStatus;
  }>;
}

export interface CurrentOrganizationResponse {
  id: string;
  name: string;
  role: MembershipRole;
}

export interface OrganizationMemberResponse {
  membershipId: string;
  userId: string;
  email: string;
  displayName: string | null;
  role: MembershipRole;
}

export interface PlatformOrganizationResponse {
  id: string;
  name: string;
  status: OrganizationStatus;
  createdAt: string;
}

export type DocumentStatus =
  'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED' | 'DELETING' | 'DELETED';

export interface DocumentResponse {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: DocumentStatus;
  /** Safe, classified failure code (e.g. EXTRACTION_EMPTY). */
  errorCode: string | null;
  uploadedBy: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
}

export interface DocumentListResponse {
  items: DocumentResponse[];
  nextCursor: string | null;
}

export interface ConversationResponse {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationListResponse {
  items: ConversationResponse[];
  nextCursor: string | null;
}

export interface CitationResponse {
  id: string;
  ordinal: number;
  documentId: string;
  documentName: string;
  locator: { page: number | null; section: string | null };
  /** Short plain-text excerpt; null when the source is no longer available. */
  excerpt: string | null;
  available: boolean;
}

export type MessageOutcome = 'ANSWERED' | 'NO_ANSWER';

export interface MessageResponse {
  id: string;
  role: 'USER' | 'ASSISTANT';
  /** Plain text. Assistant answers reference citations as [1], [2], ... */
  content: string;
  outcome: MessageOutcome | null;
  replyTo: string | null;
  citations: CitationResponse[];
  createdAt: string;
}

export interface MessageListResponse {
  items: MessageResponse[];
}

export interface AskRequest {
  content: string;
}

export interface AskResponse {
  question: MessageResponse;
  answer: MessageResponse;
}

export interface CitationSourceResponse {
  citationId: string;
  ordinal: number;
  document: { id: string; name: string; mimeType: string };
  locator: { page: number | null; section: string | null };
  /** The full cited passage (plain text; render as text, never as HTML). */
  text: string;
  /** Authenticated API path that downloads the original document. */
  originalUrl: string;
}
