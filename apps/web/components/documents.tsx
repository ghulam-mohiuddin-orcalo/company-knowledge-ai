'use client';

import type { DocumentListResponse, DocumentResponse } from '@cka/contracts';
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { ApiRequestError } from '@/lib/api-client';
import { useSession } from '@/lib/session';
import {
  Alert,
  describeError,
  Dialog,
  formatBytes,
  formatDate,
  Loading,
  StatusBadge,
} from './ui';

const POLL_MS = 3000;

const TYPE_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'DOCX',
  'text/plain': 'TXT',
};

/** Plain-language explanations for the server's safe failure codes. */
const FAILURE_REASONS: Record<string, string> = {
  EXTRACTION_EMPTY:
    'No readable text was found (scanned documents are not supported).',
  EXTRACTION_UNREADABLE: 'The file could not be read. It may be damaged.',
  EXTRACTION_ENCRYPTED: 'The file is password-protected.',
  EXTRACTION_TOO_LARGE: 'The file content is too large to process.',
  STORAGE_OBJECT_MISSING: 'The stored file is missing. Upload it again.',
  INGESTION_ATTEMPTS_EXHAUSTED:
    'Processing failed repeatedly. Try uploading again.',
};

export function failureReason(code: string | null): string {
  if (!code) return 'Processing failed.';
  return (
    FAILURE_REASONS[code] ?? 'Processing failed. Try uploading again later.'
  );
}

const UPLOAD_ERRORS: Record<string, string> = {
  DOCUMENT_UNSUPPORTED_TYPE:
    'This file type is not supported. Upload a PDF, DOCX or TXT file.',
  DOCUMENT_TOO_LARGE: 'The file is larger than the maximum upload size.',
  DOCUMENT_EMPTY: 'The file is empty.',
};

const isPending = (d: DocumentResponse) =>
  d.status === 'QUEUED' || d.status === 'PROCESSING';

/** Documents page: everyone can view; only organization admins upload and delete. */
export function DocumentsView() {
  const { api, isAdmin } = useSession();
  const [documents, setDocuments] = useState<DocumentResponse[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<DocumentResponse | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const page = await api.request<DocumentListResponse>(
        '/v1/documents?limit=50',
      );
      setDocuments(page.items);
      setNextCursor(page.nextCursor);
      setError(null);
    } catch (e) {
      setError(describeError(e));
    }
  }, [api]);

  useEffect(() => {
    api
      .request<DocumentListResponse>('/v1/documents?limit=50')
      .then((page) => {
        setDocuments(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch((e: unknown) => setError(describeError(e)));
  }, [api]);

  // Refresh while documents are still being processed.
  const pending = documents?.some(isPending) ?? false;
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [pending, load]);

  const loadMore = async () => {
    if (!nextCursor) return;
    try {
      const page = await api.request<DocumentListResponse>(
        `/v1/documents?limit=50&cursor=${encodeURIComponent(nextCursor)}`,
      );
      setDocuments((current) => [...(current ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (e) {
      setError(describeError(e));
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    const document = toDelete;
    setToDelete(null);
    try {
      await api.request(`/v1/documents/${document.id}`, { method: 'DELETE' });
      setDocuments(
        (current) => current?.filter((d) => d.id !== document.id) ?? null,
      );
      setNotice(
        `“${document.filename}” was deleted. It is no longer used for answers.`,
      );
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <>
      <div className="page-header">
        <h1>Documents</h1>
      </div>
      {isAdmin && (
        <UploadForm
          onUploaded={(document) => {
            setDocuments((current) => [document, ...(current ?? [])]);
            setNotice(
              `“${document.filename}” was uploaded and is being processed.`,
            );
          }}
        />
      )}
      {notice && <Alert kind="info">{notice}</Alert>}
      {error && <Alert>{error}</Alert>}
      {documents === null && !error && <Loading label="Loading documents…" />}
      {documents && documents.length === 0 && (
        <p>
          No documents yet.
          {isAdmin ? ' Upload a PDF, DOCX or TXT file to get started.' : ''}
        </p>
      )}
      {documents && documents.length > 0 && (
        <div className="table-wrap">
          <table>
            <caption className="visually-hidden">
              Organization documents
            </caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Type</th>
                <th scope="col">Size</th>
                <th scope="col">Uploaded</th>
                <th scope="col">Uploaded by</th>
                <th scope="col">Status</th>
                {isAdmin && (
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {documents.map((document) => (
                <tr key={document.id}>
                  <td>{document.filename}</td>
                  <td>{TYPE_LABELS[document.mimeType] ?? document.mimeType}</td>
                  <td>{formatBytes(document.sizeBytes)}</td>
                  <td>{formatDate(document.createdAt)}</td>
                  <td>{document.uploadedBy.name}</td>
                  <td>
                    <StatusBadge status={document.status} />
                    {document.status === 'FAILED' && (
                      <div className="hint">
                        {failureReason(document.errorCode)}
                      </div>
                    )}
                  </td>
                  {isAdmin && (
                    <td>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => setToDelete(document)}
                        aria-label={`Delete ${document.filename}`}
                      >
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {nextCursor && (
        <p>
          <button
            type="button"
            className="secondary"
            onClick={() => void loadMore()}
          >
            Load more
          </button>
        </p>
      )}
      {toDelete && (
        <Dialog
          title="Delete document"
          variant="centered"
          onClose={() => setToDelete(null)}
        >
          <h2>Delete document?</h2>
          <p>
            “{toDelete.filename}” will be removed and no longer used to answer
            questions. This cannot be undone.
          </p>
          <div className="form-row">
            <button
              type="button"
              className="danger"
              onClick={() => void confirmDelete()}
            >
              Delete
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setToDelete(null)}
            >
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

function UploadForm({
  onUploaded,
}: {
  onUploaded: (document: DocumentResponse) => void;
}) {
  const { api } = useSession();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const file = input.current?.files?.[0];
    if (!file) {
      setError('Choose a file to upload.');
      return;
    }
    const body = new FormData();
    body.append('file', file, file.name);
    setUploading(true);
    setError(null);
    try {
      onUploaded(
        await api.request<DocumentResponse>('/v1/documents', {
          method: 'POST',
          body,
        }),
      );
      if (input.current) input.current.value = '';
    } catch (e) {
      setError(
        e instanceof ApiRequestError && UPLOAD_ERRORS[e.code]
          ? UPLOAD_ERRORS[e.code]!
          : describeError(e),
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <form
      className="card"
      onSubmit={(event) => void submit(event)}
      aria-label="Upload document"
    >
      <div className="form-row">
        <div className="field">
          <label htmlFor="document-file">Upload a document</label>
          <input
            ref={input}
            id="document-file"
            type="file"
            accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
            aria-describedby="document-file-hint"
            disabled={uploading}
          />
          <span id="document-file-hint" className="hint">
            PDF, DOCX or TXT.
          </span>
        </div>
        <button type="submit" disabled={uploading}>
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
      </div>
      {error && <Alert>{error}</Alert>}
    </form>
  );
}
