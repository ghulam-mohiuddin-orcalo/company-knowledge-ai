import type { CitationResponse } from '@cka/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { AnswerContent, CitationList } from './answer';

const citation = (
  ordinal: number,
  overrides: Partial<CitationResponse> = {},
): CitationResponse => ({
  id: `c${ordinal}`,
  ordinal,
  documentId: 'd1',
  documentName: `Doc ${ordinal}.pdf`,
  locator: { page: ordinal, section: null },
  excerpt: `excerpt ${ordinal}`,
  available: true,
  ...overrides,
});

describe('AnswerContent (E7-T03)', () => {
  it('turns only server-backed [n] markers into source buttons', () => {
    const onOpen = vi.fn();
    render(
      <p>
        <AnswerContent
          content="Leave is 27 days [1]. Also see [3] and [2]."
          citations={[citation(1), citation(2)]}
          onOpen={onOpen}
        />
      </p>,
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['[1]', '[2]']);
    expect(screen.getByText(/Also see \[3\] and/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Source 2: Doc 2.pdf' }),
    );
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'c2' }));
  });

  it('renders markup from answers, excerpts and file names as text', () => {
    const payload = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const { container } = render(
      <div>
        <AnswerContent
          content={`${payload} [1]`}
          citations={[citation(1)]}
          onOpen={vi.fn()}
        />
        <CitationList
          citations={[citation(1, { documentName: payload, excerpt: payload })]}
          onOpen={vi.fn()}
        />
      </div>,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it('marks unavailable sources without an excerpt', () => {
    render(
      <CitationList
        citations={[citation(1, { available: false, excerpt: null })]}
        onOpen={vi.fn()}
      />,
    );

    expect(
      screen.getByText('This source is no longer available.'),
    ).toBeTruthy();
  });
});
