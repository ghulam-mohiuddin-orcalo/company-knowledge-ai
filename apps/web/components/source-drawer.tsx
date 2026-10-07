'use client';

import type { CitationResponse, CitationSourceResponse } from '@cka/contracts';
import { useEffect, useState } from 'react';
import { ApiRequestError } from '@/lib/api-client';
import { useSession } from '@/lib/session';
import { Alert, describeError, describeLocator, Dialog, Loading } from './ui';

type SourceState =
  | { status: 'loading' }
  | { status: 'ready'; source: CitationSourceResponse }
  | { status: 'unavailable' }
  | { status: 'not-found' }
  | { status: 'error'; message: string };

/**
 * Source view for a citation. The API re-authorizes every request; this only
 * shows what it returns, as plain text.
 */
export function SourceDrawer({
  citation,
  onClose,
}: {
  citation: CitationResponse;
  onClose: () => void;
}) {
  const { api } = useSession();
  const [state, setState] = useState<SourceState>({ status: 'loading' });
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .request<CitationSourceResponse>(`/v1/citations/${citation.id}/source`)
      .then((source) => active && setState({ status: 'ready', source }))
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiRequestError && error.status === 410) {
          setState({ status: 'unavailable' });
        } else if (error instanceof ApiRequestError && error.status === 404) {
          setState({ status: 'not-found' });
        } else {
          setState({ status: 'error', message: describeError(error) });
        }
      });
    return () => {
      active = false;
    };
  }, [api, citation.id]);

  const download = async (source: CitationSourceResponse) => {
    setDownloadError(null);
    try {
      const { blob, filename } = await api.download(source.originalUrl);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename ?? source.document.name;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setDownloadError(describeError(error));
    }
  };

  return (
    <Dialog title={`Source ${citation.ordinal}`} onClose={onClose}>
      <div className="page-header">
        <h2>Source {citation.ordinal}</h2>
        <button type="button" className="secondary" onClick={onClose}>
          Close
        </button>
      </div>
      {state.status === 'loading' && <Loading label="Loading source…" />}
      {state.status === 'unavailable' && (
        <Alert kind="info">
          This source is no longer available. The document may have been
          deleted.
        </Alert>
      )}
      {state.status === 'not-found' && (
        <Alert>This source could not be found.</Alert>
      )}
      {state.status === 'error' && <Alert>{state.message}</Alert>}
      {state.status === 'ready' && (
        <>
          <dl>
            <dt>Document</dt>
            <dd>{state.source.document.name}</dd>
            <dt>Location</dt>
            <dd>{describeLocator(state.source.locator)}</dd>
          </dl>
          <h3>Cited passage</h3>
          <pre className="source-text">{state.source.text}</pre>
          <div>
            <button type="button" onClick={() => void download(state.source)}>
              Download original
            </button>
          </div>
          {downloadError && <Alert>{downloadError}</Alert>}
        </>
      )}
    </Dialog>
  );
}
