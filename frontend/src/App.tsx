import { useEffect, useState } from 'react';
import { HomePage } from './pages/HomePage';
import { SessionPage } from './pages/SessionPage';

/**
 * Routing.
 *
 * Two routes and no navigation between them beyond a full page load, so a
 * router dependency would not earn its place.
 */
function roomIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/session\/([A-Za-z0-9_-]+)\/?$/);
  return match ? match[1] : null;
}

export function App() {
  const [roomId, setRoomId] = useState(() => roomIdFromPath(window.location.pathname));

  useEffect(() => {
    const onPop = () => setRoomId(roomIdFromPath(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  return roomId ? <SessionPage roomId={roomId} /> : <HomePage />;
}
