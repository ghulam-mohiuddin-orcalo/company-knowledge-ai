'use client';

import type { CitationResponse } from '@cka/contracts';
import { Fragment, type ReactNode } from 'react';
import { describeLocator } from './ui';

/**
 * Renders an answer as plain text. Only [n] markers that match a server-backed
 * citation become buttons; everything else, including any markup the model or
 * a document produced, is shown as text (React escapes it).
 */
export function AnswerContent({
  content,
  citations,
  onOpen,
}: {
  content: string;
  citations: CitationResponse[];
  onOpen: (citation: CitationResponse) => void;
}) {
  const byOrdinal = new Map(citations.map((c) => [c.ordinal, c]));
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of content.matchAll(/\[(\d+)\]/g)) {
    const citation = byOrdinal.get(Number(match[1]));
    if (!citation) continue;
    parts.push(content.slice(last, match.index));
    parts.push(
      <button
        key={`${match.index}-${citation.id}`}
        type="button"
        className="link"
        onClick={() => onOpen(citation)}
        aria-label={`Source ${citation.ordinal}: ${citation.documentName}`}
      >
        [{citation.ordinal}]
      </button>,
    );
    last = match.index + match[0].length;
  }
  parts.push(content.slice(last));
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>{part}</Fragment>
      ))}
    </>
  );
}

/** Numbered sources under an answer. */
export function CitationList({
  citations,
  onOpen,
}: {
  citations: CitationResponse[];
  onOpen: (citation: CitationResponse) => void;
}) {
  if (citations.length === 0) return null;
  return (
    <ol className="citations" aria-label="Sources">
      {citations.map((citation) => (
        <li key={citation.id} value={citation.ordinal}>
          <button
            type="button"
            className="link"
            onClick={() => onOpen(citation)}
          >
            {citation.documentName}
          </button>{' '}
          <span className="hint">{describeLocator(citation.locator)}</span>
          {citation.available ? (
            citation.excerpt && <div className="hint">“{citation.excerpt}”</div>
          ) : (
            <div className="hint">This source is no longer available.</div>
          )}
        </li>
      ))}
    </ol>
  );
}
