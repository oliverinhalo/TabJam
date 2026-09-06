import { useState } from 'react';
import { guessDeviceName } from '../lib/device';

interface Props {
  onConfirm: (name: string) => void;
}

/**
 * Ask who is at this screen.
 *
 * Shown once per tab, because a tab is a player: several people reading
 * different parts off one machine each need their own name in the list, and
 * "PC" three times over tells nobody which screen is which. Declining is a
 * first-class option — the device name is a perfectly good answer when one
 * person is on one device.
 */
export function JoinDialog({ onConfirm }: Props) {
  const [name, setName] = useState('');
  const fallback = guessDeviceName();

  const submit = () => onConfirm(name.trim() || fallback);

  return (
    <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="join-title">
      <div className="dialog__panel">
        <h2 id="join-title" className="dialog__title">Who&rsquo;s on this screen?</h2>
        <p className="dialog__hint">
          Shown to the rest of the band. Each tab is its own player, so two
          people on one computer each get a name.
        </p>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <input
            type="text"
            value={name}
            autoFocus
            maxLength={40}
            placeholder={fallback}
            onChange={(event) => setName(event.target.value)}
            aria-label="Your name"
          />

          <div className="dialog__actions">
            <button type="submit" className="button">
              {name.trim() ? `Join as ${name.trim()}` : 'Join'}
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => onConfirm(fallback)}
            >
              Skip, use &ldquo;{fallback}&rdquo;
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
