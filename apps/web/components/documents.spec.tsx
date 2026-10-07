import type { DocumentResponse } from '@cka/contracts';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithSession } from '@/test/session';
import { DocumentsView, failureReason } from './documents';

const doc = (overrides: Partial<DocumentResponse>): DocumentResponse => ({
  id: 'd1',
  filename: 'Handbook.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 2048,
  status: 'READY',
  errorCode: null,
  uploadedBy: { id: 'u1', name: 'Admin' },
  createdAt: '2026-10-06T10:00:00.000Z',
  updatedAt: '2026-10-06T10:00:00.000Z',
  ...overrides,
});

const routes = {
  '/v1/documents': {
    items: [
      doc({}),
      doc({
        id: 'd2',
        filename: '<b>evil</b>.txt',
        status: 'FAILED',
        errorCode: 'EXTRACTION_EMPTY',
      }),
    ],
    nextCursor: null,
  },
};

describe('DocumentsView (E2-T06)', () => {
  it('gives organization admins upload and delete controls', async () => {
    renderWithSession(<DocumentsView />, { role: 'ORG_ADMIN', routes });

    expect(await screen.findByText('Handbook.pdf')).toBeTruthy();
    expect(screen.getByLabelText('Upload a document')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Delete Handbook.pdf' }),
    ).toBeTruthy();
  });

  it('gives members a read-only list', async () => {
    renderWithSession(<DocumentsView />, { role: 'MEMBER', routes });

    expect(await screen.findByText('Handbook.pdf')).toBeTruthy();
    expect(screen.queryByLabelText('Upload a document')).toBeNull();
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull();
  });

  it('shows status, failure reasons and file names as text', async () => {
    const { container } = renderWithSession(<DocumentsView />, { routes });

    expect(await screen.findByText('Failed')).toBeTruthy();
    expect(screen.getByText(failureReason('EXTRACTION_EMPTY'))).toBeTruthy();
    expect(screen.getByText('<b>evil</b>.txt')).toBeTruthy();
    expect(container.querySelector('b')).toBeNull();
  });
});

describe('upload (E2-T06)', () => {
  it('uploads the chosen file and shows it as processing', async () => {
    const { request } = renderWithSession(<DocumentsView />, {
      role: 'ORG_ADMIN',
      routes: { '/v1/documents': { items: [], nextCursor: null } },
    });
    await screen.findByText(/No documents yet/);
    request.mockImplementation(
      async (path: string, options?: { method?: string }) =>
        options?.method === 'POST'
          ? doc({ id: 'new', filename: 'notes.txt', status: 'QUEUED' })
          : { items: [], nextCursor: null },
    );
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });

    fireEvent.change(screen.getByLabelText('Upload a document'), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    expect(
      await screen.findByText(
        '“notes.txt” was uploaded and is being processed.',
      ),
    ).toBeTruthy();
    const call = request.mock.calls.find(([, o]) => o?.method === 'POST')!;
    const options = call[1] as { body: FormData };
    expect(call[0]).toBe('/v1/documents');
    expect(options.body.get('file')).toBeInstanceOf(File);
    expect(screen.getByText('Queued')).toBeTruthy();
  });
});
