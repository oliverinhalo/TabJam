/**
 * Per-tab identity.
 *
 * Deliberately sessionStorage rather than localStorage: localStorage is shared
 * by every tab in a browser, so two tabs on the same machine were one
 * participant with two sockets. Both then believed they held the audio role and
 * played at once, slightly out of phase, and neither could be silenced on its
 * own. sessionStorage is per tab, so each window is its own player — which is
 * the point when several people are reading different parts off one machine —
 * while a reload keeps the same identity and its audio role.
 */

const DEVICE_ID_KEY = 'tabjam.deviceId';
const DEVICE_NAME_KEY = 'tabjam.deviceName';

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `d-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/** Falls back to a value held only in memory when storage is unavailable. */
let inMemoryId: string | null = null;

export function getDeviceId(): string {
  try {
    const existing = sessionStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const created = randomId();
    sessionStorage.setItem(DEVICE_ID_KEY, created);
    return created;
  } catch {
    inMemoryId ??= randomId();
    return inMemoryId;
  }
}

/**
 * Take a new identity.
 *
 * Needed because duplicating a tab copies its sessionStorage, so the copy
 * arrives claiming an id another tab is already using — reintroducing the exact
 * clash this file exists to avoid.
 */
export function regenerateDeviceId(): string {
  const created = randomId();
  try {
    sessionStorage.setItem(DEVICE_ID_KEY, created);
  } catch {
    inMemoryId = created;
  }
  return created;
}

/** Guess a friendly default from the platform, so lists aren't all "Player". */
export function guessDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Macintosh/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'PC';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Player';
}

/** The name chosen for this tab, or null if nobody has been asked yet. */
export function getStoredName(): string | null {
  try {
    return sessionStorage.getItem(DEVICE_NAME_KEY);
  } catch {
    return null;
  }
}

export function getDeviceName(): string {
  return getStoredName() ?? guessDeviceName();
}

export function setDeviceName(name: string): void {
  try {
    sessionStorage.setItem(DEVICE_NAME_KEY, name);
  } catch {
    // Nothing to do; the name just won't survive a reload.
  }
}
