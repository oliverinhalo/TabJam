/**
 * Stable per-browser identity.
 *
 * There are no accounts in TabJam, so a device is identified by a random id
 * kept in localStorage. That is what lets the same phone reclaim its place (and
 * its audio-output role) after a reload or a dropped connection.
 */

const DEVICE_ID_KEY = 'tabjam.deviceId';
const DEVICE_NAME_KEY = 'tabjam.deviceName';

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `d-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const created = randomId();
    localStorage.setItem(DEVICE_ID_KEY, created);
    return created;
  } catch {
    // Private mode with storage blocked: fall back to a per-session id.
    return randomId();
  }
}

/** Guess a friendly default name from the platform, so lists aren't all "Player". */
function guessDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Macintosh/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'PC';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Player';
}

export function getDeviceName(): string {
  try {
    return localStorage.getItem(DEVICE_NAME_KEY) ?? guessDeviceName();
  } catch {
    return guessDeviceName();
  }
}

export function setDeviceName(name: string): void {
  try {
    localStorage.setItem(DEVICE_NAME_KEY, name);
  } catch {
    // Nothing to do; the name just won't persist.
  }
}
