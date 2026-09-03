import { useState } from 'react';
import { api } from '../lib/api';

/** Landing page: start a room, or join one by id. */
export function HomePage() {
  const [busy, setBusy] = useState(false);
  const [joinId, setJoinId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createRoom = async () => {
    setBusy(true);
    setError(null);
    try {
      const { roomId } = await api.createRoom();
      window.location.assign(`/session/${roomId}`);
    } catch {
      setError('Could not create a session. Is the server running?');
      setBusy(false);
    }
  };

  return (
    <main className="home">
      <div className="home__card">
        <h1 className="home__logo">TabJam</h1>
        <p className="home__tagline">
          Everyone in the band on the same bar, on their own instrument.
        </p>

        <button
          type="button"
          className="button button--big"
          disabled={busy}
          onClick={() => void createRoom()}
        >
          {busy ? 'Starting…' : 'Start a session'}
        </button>

        <div className="home__divider"><span>or join one</span></div>

        <form
          className="field field--inline"
          onSubmit={(event) => {
            event.preventDefault();
            const id = joinId.trim();
            if (id) window.location.assign(`/session/${id}`);
          }}
        >
          <input
            type="text"
            placeholder="Session code"
            value={joinId}
            onChange={(event) => setJoinId(event.target.value)}
          />
          <button type="submit" className="button button--ghost">Join</button>
        </form>

        {error && <div className="alert alert--error">{error}</div>}

        <p className="home__note">
          Notation comes from Guitar Pro files you add yourself. Once a session is
          running, share its link with the band.
        </p>
      </div>
    </main>
  );
}
