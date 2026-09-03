# TabJam

Synchronized tab practice for a band. Everyone opens the same link on their own
phone, tablet or laptop, picks the instrument *they* care about, and the playhead
stays locked to the same bar across every device — while only one device
actually makes sound.

Built to be self-hosted: one container, no accounts, no database.

---

## What it does

- **One link per session.** Create a session, share the link, everyone joins.
- **Per-person instrument view.** You watch rhythm guitar, the drummer watches
  drums. Track selection is local and never synced — that's the point.
- **Locked playhead.** Play, pause and seek from any device; every cursor
  follows.
- **One audio device.** Exactly one device produces sound (whoever's plugged
  into the PA). Anyone can claim it with a button.
- **Shared controls.** Volume, metronome (click *or* a spoken beat count),
  transpose, speed and loop apply to the whole room.
- **Song switching.** Load a different song into the same room mid-practice;
  earlier songs stay one click away.
- **Transpose and capo.** Room-wide transpose, plus per-track transpose and a
  per-track capo.
- **Loop a section.** Pick a bar range and drill it.
- **Track mixer.** Mute, solo and volume per track — silence the guitar and play
  it yourself.
- **Notation, tab or both.** Toggle the standard staff, the tab staff and chords
  independently — per device, so the singer reads notation while the guitarist
  reads tab off the same file.
- **Searchable library.** Search and sort your songs; add a whole set in one go.
- **Zoom.** Per device, because a phone on a music stand isn't a laptop.

## Read this before you start: where notation comes from

**TabJam plays Guitar Pro files that you supply.** You add them by uploading
through the UI or by dropping them into `data/library/`.

The original plan for this project was to resolve a Songsterr link to the
Guitar Pro file behind it and stream that. **That isn't possible, and TabJam
doesn't do it.** Checking against the live site:

- Songsterr's player doesn't render from a `.gp*` file at all. It renders from
  an internal per-track format keyed by a hash on each track.
- That data is served from an S3-backed host (`gp.songsterr.com`) that returns
  `403 AccessDenied` to unauthenticated requests.
- Guitar Pro appears in Songsterr's own web client only as an **import**
  feature — there's no export or download route to call.

So getting notation out of Songsterr would mean working around an access
control rather than fetching something public, which this project doesn't do.

**What Songsterr is still used for:** metadata. Paste a Songsterr URL or song id
into the lookup box and TabJam shows you the title, artist and the real track
list (instrument names, tunings, which track is drums) — handy for identifying a
song and checking that your own file matches. That uses Songsterr's public JSON
endpoints and downloads no notation.

If you later have a legitimate source for the files, it's a small change:
everything lives behind the `ScoreSource` interface in
`backend/src/sources/`, and `songsterr.ts` is the only file that knows anything
about Songsterr.

### Where to get Guitar Pro files

Files you already own, files you transcribe yourself in Guitar Pro or
MuseScore (which exports `.gp`), or anywhere else you're entitled to get them.
`.gp`, `.gpx`, `.gp5`, `.gp4` and `.gp3` all work — alphaTab parses all of them.

Naming files `Artist - Title.gp5` gets you a sensible title and artist in the UI
for free.

---

## Install with Docker

Everything runs as one container. You need Docker with the Compose plugin
(`docker compose version` should print something) — nothing else.

```bash
git clone https://github.com/oliverinhalo/TabJam.git
cd TabJam
cp .env.example .env
docker compose up -d --build
```

That's it. Open **http://localhost:8080**, click *Start a session*, and share the
link with the band.

The first build takes a few minutes (it compiles the frontend); later ones are
cached and quick.

### Check it came up

```bash
docker compose ps          # should show "healthy"
curl localhost:8080/api/health
# {"status":"ok","uptimeSeconds":12,"rooms":0,"participants":0}
```

The container has a built-in healthcheck, so `healthy` means the server is
genuinely serving, not just running.

### Add songs

Notation comes from Guitar Pro files you supply — `.gp`, `.gpx`, `.gp5`, `.gp4`
or `.gp3`. Two ways in, both equivalent:

- **Through the UI** — the file picker in the Songs panel takes as many files at
  once as you like, so a whole set goes in in one go.
- **On disk** — drop files into `./data/library/` next to the compose file. It's
  bind-mounted into the container, so they appear without a restart.

Naming them `Artist - Title.gp5` gets you a proper title and artist in the UI.
The Songsterr lookup shows you the exact filename to use for a given song.

The library is searchable and sortable by recent, title or artist, which is
what makes a few hundred files usable rather than a wall of names.

**On automatic downloading.** TabJam won't sign in to Songsterr for you or bulk
download from it. Fetching a file you have rights to is yours to do; a tool that
replays your credentials to pull the catalogue automatically is a different
thing, and not one this project builds. Multi-file upload exists so that adding
what you have downloaded is a single step rather than a chore.

### Everyday commands

```bash
docker compose logs -f          # follow logs
docker compose restart          # restart
docker compose down             # stop and remove the container
docker compose up -d --build    # update after a git pull
```

Your library lives in `./data/library` on the host, so none of these lose songs.

### Configuration

Everything is optional — the defaults in `.env.example` work as-is.

| Variable | Default | What it does |
| --- | --- | --- |
| `APP_PORT` | `8080` | Host port. Change it if 8080 is taken. The container always listens on 8080 internally. |
| `PUBLIC_ORIGIN` | *(derived)* | Set behind a reverse proxy so shared session links use your public hostname instead of the container's. |
| `MAX_UPLOAD_MB` | `25` | Upload size limit. |

To run on a different port, edit `.env`:

```bash
APP_PORT=9090
```

then `docker compose up -d`.

### Running without Docker

If you'd rather not use Docker:

```bash
npm ci
npm run build
node backend/dist/index.js      # serves on :8080
```

Node 20 or newer. Set `STATIC_DIR=frontend/dist` if you run it from somewhere
other than the repo root.

### Behind a reverse proxy

TabJam works through a proxy out of the box. It connects with HTTP long-polling
first and upgrades to a WebSocket when the proxy allows it, so a proxy that
doesn't forward `Upgrade` headers still works — just with slightly more
overhead. Forwarding them is worth doing anyway.

Set `PUBLIC_ORIGIN` in `.env` to your public URL so shared session links point
at the right hostname:

```bash
PUBLIC_ORIGIN=https://tabjam.example.com
```

**nginx**

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;   # these two lines
    proxy_set_header Connection "upgrade";    # enable WebSockets
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

**Caddy** handles WebSockets automatically:

```caddy
tabjam.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

**Traefik** — see the commented label block in `docker-compose.yml`.

Serving over HTTPS also unlocks the microphone-based Sync check, which browsers
only allow in a secure context.

## Running it in development

```bash
npm install
npm run dev
```

Backend on `:8080`, Vite dev server on `:5173` (which proxies `/api` and
`/socket.io` to the backend). Open `http://localhost:5173`.

Useful scripts:

| Command | Does |
| --- | --- |
| `npm run dev` | Backend + frontend with hot reload |
| `npm run build` | Build all three workspaces in dependency order |
| `npm run typecheck` | Typecheck everything |

---

## How the sync works

The server holds the authoritative transport state per room:

```ts
{ isPlaying, tempoBpm, positionMs, updatedAt }
```

- Any participant can play, pause or seek. The change goes to the server, which
  broadcasts it to the room.
- **The audio-output device is the clock.** It plays locally through alphaTab
  and reports its real position every 500ms. The server rebroadcasts that to
  everyone else. Position reports from any other device are ignored outright —
  there's exactly one source of truth.
- Other devices correct against that position only when they've drifted more
  than ~1.5s. Between corrections their own cursor keeps moving, so the playhead
  glides instead of stuttering.

That tolerance is deliberate. Only one device makes sound, so the others just
need a highlight that's right to about a bar — a couple hundred milliseconds is
invisible. Sample-accurate sync across independent devices is a much harder
problem (see *Not built* below).

### One detail worth knowing

Every device runs alphaTab's synth, but non-audio devices run it at **volume
zero**. alphaTab drives its cursor from the synth clock, so switching the player
off entirely would mean no cursor at all. A silent local synth gives smooth
cursor motion for free and needs the network only for drift correction.

---

## Transpose vs capo

They are different things and TabJam treats them differently.

**Transpose** moves the music. Set it room-wide in Room settings, or per track in
the track list — the two add together, so a room-wide `-2` with a track at `+1`
puts that track at `-1`. Both what you read and what you hear move, so the band
stays in one key.

**Capo** does not move the music. It renumbers the frets to what you actually
press with a capo on, and the pitch is unchanged — put a capo on 2 and a part
written at fret 5 reads as fret 3, sounding exactly as before. It is per track,
because only some of you have a capo on.

Both use steppers rather than sliders. A slider fires a change per pixel of a
drag, and each one costs a room-wide round trip and a full score re-render, so
the value you land on could be lost in the queue — which looks exactly like a
particular value "not working". One press, one change.

A note on how capo is built, since it is not obvious from the code: alphaTab's
own `Staff.capo` was measured to leave the written frets untouched (it models a
capo the Guitar Pro way, raising pitch while the tab stays as written), and
`displayTranspositionPitches` does not move tab numbers either. So the capo is
built from the notation transposition offset, with the audio given its own
value that excludes the capo term. Reading moves; pitch does not.

## Practice tools

- **Loop a section.** *Loop a section* in Room settings picks a bar range and
  repeats it. Shared, so everyone drills the same four bars.
- **Track mixer.** Each track in the track list has mute, solo and volume,
  shared with the room. Mute the part you are playing and the rest keeps going.
- **Speed.** Playback rate without changing pitch.
- **Count-in.** A bar of clicks before playback starts.
- **Zoom.** Notation size, local to your device — it is not synced, for the same
  reason track *visibility* is not.

## Sync check (acoustic calibration)

WebSocket sync can't see one thing: how long it takes a sound to actually leave
the speaker after the browser is told to play it. A phone's built-in speaker is
near-instant, but a Bluetooth speaker or wireless headphones can add 100–300ms
that no amount of network timing will reveal. TabJam measures that directly, by
playing a short chirp and listening for it with the device's own microphone.

This is an **on-demand check, not continuous listening**. A practice room with
live drums and amps is far too loud to track the song mix in real time. The
check takes about a second and runs in a quiet moment.

**When it runs**

- Automatically when a device becomes the audio-output device (the tap on
  *Play audio on this device* is also the user gesture iOS needs).
- Manually, any time, via **Recalibrate** in the Sync check panel.

**What it measures**

The panel shows two numbers, because they mean different things:

- **Measured round trip** — what was actually observed: speaker → air →
  microphone. This is a real measurement.
- **Speaker delay** — the share of that attributable to the output path, which
  is the part sync actually needs. Chrome and Firefox report
  `AudioContext.outputLatency` (and it does account for Bluetooth), so that's
  used when available. Safari doesn't implement it, so there the round trip is
  split in half on the assumption that the input and output chains are roughly
  symmetric. That's an assumption, which is exactly why both numbers are shown.

The speaker delay is then subtracted from the positions the audio device
broadcasts, so everyone else's cursor follows the sound people *hear* rather
than the sound the synth thinks it has already made.

**Aligning the room: everyone waits for the slowest**

Devices differ. A phone speaker is near-instant; a Bluetooth speaker might be
250ms behind. Left alone they play as a flam and no single cursor position is
right for everyone.

So the room runs at the pace of its **slowest** device:

1. Each device measures its own speaker delay.
2. The server takes the largest of those — the *room pace* — counting only
   devices actually producing sound. A silent phone paired to slow headphones
   says nothing about when the room hears a note, so it sets no pace.
3. Every other device waits `pace − its own delay` before starting.

A device measured at 30ms in a room paced at 210ms waits 180ms; the 210ms device
waits nothing. All of them are then heard at the same moment, and the cursor
sits on the bar people are actually hearing. The participant list shows each
device's measured delay and marks the one setting the pace.

This is also what makes **several devices play at once** workable — two people
each monitoring through their own amp. Turn it on per device with *Also play
audio here*.

Nothing is calibrated? Then the pace is 0, every compensation is 0, and the app
behaves exactly as it did before any of this existed.

**Mutual round**

*Sync all devices* runs a round where every device plays a tone in turn while
the others listen. Turns are sequential on purpose: two chirps overlapping in
the air are indistinguishable to a matched filter looking for one waveform.

Each device's own loopback is what produces its latency figure. Cross-device
arrival times alone can't: hearing another device tells you its output delay
plus the air plus your own *input* delay — three unknowns in one number. The
loopback separates the output path cleanly, and the cross-device readings act
as a sanity check on it.

**Privacy**

No audio ever leaves the device. Detection runs locally and only a single
number, in milliseconds, goes over the WebSocket. There's no audio streaming
anywhere, and no WebRTC.

**Requirements and failure modes**

- **HTTPS is required.** `getUserMedia` needs a secure context, and it's easy to
  leave a self-hosted app on plain HTTP inside the LAN. Without TLS the panel
  says so and calibration is unavailable. `localhost` counts as secure, so it
  works for local testing.
- **It is purely an enhancement.** Decline the microphone, have no microphone,
  or run over HTTP, and everything works exactly as it does otherwise, on
  network-only sync. Nothing depends on a calibration result existing.
- A measurement is cached for a day, then discarded — it describes whatever was
  plugged in at the time, and a stale one is a guess about different hardware.

**Why a chirp and not the song**

A 50ms sweep from 1.5–4.5kHz has a sharp autocorrelation peak, so a matched
filter locks onto it to within a sample. Fingerprinting an arbitrary,
ever-changing multi-instrument mix in real time is a much harder problem that
wouldn't survive a real band. The band is 1.5–4.5kHz because that's where small
phone speakers and microphones actually work; near-ultrasonic chirps are
tempting for being unobtrusive, but cheap phone hardware rolls off above ~18kHz,
so they fail on exactly the devices people bring to practice. A higher-frequency
variant is defined in `dsp.ts` if your own devices handle it.

The detector has tests that plant a chirp at a known offset in synthetic noise:

```bash
npm test
```

It recovers the delay to the sample, holds up with the chirp 8dB *below* the
noise, and refuses to report a detection in noise alone.

## Architecture

```
shared/     TypeScript types shared by both sides (room state, socket events)
backend/    Express + Socket.io
  sources/  Score sources behind one interface:
              library.ts   files on disk + uploads   <- notation comes from here
              url.ts       fetch a .gp* from a URL you give it
              songsterr.ts metadata lookup only      <- see the note above
  rooms/    In-memory room state + socket handlers
  http/     REST routes
frontend/   React + Vite + alphaTab
  lib/dsp.ts          chirp synthesis + matched-filter detection (pure, tested)
  lib/calibration.ts  microphone capture and the measurement itself
  lib/clock.ts        NTP-style server/client clock estimation
```

**No database.** Room state lives in memory in a single Node process, which is
right for a handful of people on one box. Rooms survive everyone disconnecting
(for 6 hours) but not a server restart. Uploaded files *do* survive restarts —
they're on disk. If you want sessions to survive restarts too, `RoomStore` is
plain data with no I/O, so persisting it to SQLite on change and reading it back
at boot is a contained change.

**No accounts.** A session is as private as its link. Fine for one band on a
home server; don't put this on the public internet and expect privacy.

### Notes on dependencies

- **alphaTab 1.8.4** does the heavy lifting: parses Guitar Pro files, renders
  notation and tab, and provides the synth. Its API uses plain properties
  (`api.masterVolume = 0.5`), not the getter/setter *methods* you'll see in older
  tutorials.
- The Vite plugin now lives in a separate package, `@coderline/alphatab-vite`.
  The one bundled inside `@coderline/alphatab` is deprecated and its file is
  missing from the published 1.8.4 tarball, so importing `@coderline/alphatab/vite`
  fails at build time. It needs Vite 7+.
- alphaTab ships **no soundfont** in the npm package, so the synth loads one from
  a CDN by default. For a fully offline install, self-host a `.sf3` and set
  `VITE_SOUNDFONT_URL` at build time.
- **The music font is load-bearing, and its failure is silent.** alphaTab draws
  notation with the Bravura SMuFL font and will not render a single note without
  it — it logs "Font not available, rendering cannot start" and stops, while the
  synth carries on. The symptom is a blank score that plays audio perfectly,
  which looks like a CSS or layout problem and is not.

  Two things have to line up. `core.fontDirectory` is pinned to `/font/` in
  `useAlphaTab.ts`, because alphaTab otherwise derives it from its own script
  URL — which resolves to `/assets/font/` in a build and into Vite's pre-bundle
  directory in dev, neither of which holds the font. And the font is placed in
  `frontend/public/font/` by `scripts/copy-fonts.mjs` (run automatically before
  dev and build) rather than by the alphaTab plugin's own asset copy, which
  races Vite emptying `outDir` and so shipped the font only on some builds.

  If the score ever goes blank again, open the console and look for that font
  message before anything else.

---

## Not built (and why)

- **Sample-accurate multi-device audio.** Several devices can play together and
  are aligned to the slowest, but the wait is a timer, so it carries a few
  milliseconds of scheduling jitter. That is well inside the tolerance for the
  100-300ms differences it exists to correct, and far from sample-accurate.
- **Continuous acoustic tracking during playback.** Deliberately out of scope:
  a loud room defeats it, and the on-demand check gets the same number without
  fighting live drums.
- **Side-by-side track panes.** Selected tracks currently render stacked
  vertically via alphaTab's native multi-track layout. True split-screen panes
  (one alphaTab instance per track over a shared `Score`, in a responsive grid)
  is the natural follow-up.
- **Session persistence across restarts.** See the SQLite note above.

## Licence

MPL-2.0, matching alphaTab.
