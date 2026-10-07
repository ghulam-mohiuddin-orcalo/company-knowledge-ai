import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Dialog } from './ui';

/** Parent that re-renders (like the documents page polling) with an inline onClose. */
function Harness({ onClose }: { onClose: () => void }) {
  const [, setTick] = useState(0);
  return (
    <>
      <button type="button">Opener</button>
      <Dialog title="Confirm" onClose={() => onClose()}>
        <button type="button">Inside</button>
        <button type="button" onClick={() => setTick((n) => n + 1)}>
          Rerender
        </button>
      </Dialog>
    </>
  );
}

describe('Dialog (E7-T05)', () => {
  it('keeps focus where the user put it when the parent re-renders', () => {
    render(<Harness onClose={vi.fn()} />);
    expect(document.activeElement).toBe(
      screen.getByRole('dialog', { name: 'Confirm' }),
    );

    const rerender = screen.getByRole('button', { name: 'Rerender' });
    rerender.focus();
    fireEvent.click(rerender);

    expect(document.activeElement).toBe(rerender);
  });

  it('closes on Escape with the latest handler and returns focus to the opener', () => {
    const onClose = vi.fn();
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { unmount } = render(<Harness onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
