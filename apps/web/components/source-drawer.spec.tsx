import type { CitationResponse } from '@cka/contracts';
import { screen } from '@testing-library/react';
import { ApiRequestError } from '@/lib/api-client';
import { renderWithSession } from '@/test/session';
import { SourceDrawer } from './source-drawer';

const citation: CitationResponse = {
  id: 'c1',
  ordinal: 1,
  documentId: 'd1',
  documentName: 'Handbook.docx',
  locator: { page: null, section: 'Annual Leave' },
  excerpt: 'x',
  available: true,
};

describe('SourceDrawer (E7-T03)', () => {
  it('shows the authorized source with its location', async () => {
    renderWithSession(<SourceDrawer citation={citation} onClose={vi.fn()} />, {
      routes: {
        '/v1/citations/c1/source': {
          citationId: 'c1',
          ordinal: 1,
          document: { id: 'd1', name: 'Handbook.docx', mimeType: 'text/plain' },
          locator: { page: null, section: 'Annual Leave' },
          text: 'Employees receive 27 days.',
          originalUrl: '/v1/citations/c1/source/original',
        },
      },
    });

    expect(await screen.findByText('Employees receive 27 days.')).toBeTruthy();
    expect(screen.getByText('Section: Annual Leave')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Source 1' })).toBeTruthy();
  });

  it.each([
    [
      new ApiRequestError(410, 'SOURCE_UNAVAILABLE', 'gone'),
      /no longer available/,
    ],
    [new ApiRequestError(404, 'NOT_FOUND', 'nope'), /could not be found/],
    [
      new ApiRequestError(503, 'X', 'Temporarily unavailable.'),
      /Temporarily unavailable/,
    ],
  ])('handles %s gracefully', async (error, message) => {
    renderWithSession(<SourceDrawer citation={citation} onClose={vi.fn()} />, {
      routes: { '/v1/citations/c1/source': error },
    });

    expect(await screen.findByText(message)).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Download original' }),
    ).toBeNull();
  });
});
