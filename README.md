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

## Quick start

```bash
git clone https://github.com/oliverinhalo/TabJam.git
cd TabJam
cp .env.example .env      # set APP_PORT if 8080 is taken
docker compose up -d --build
```

Open `http://localhost:8080`, click **Start a session**, share the link.

Add songs either way:

- **Through the UI** — the file picker in the session sidebar, or
- **On disk** — drop `.gp*` files into `./data/library/` (bind-mounted into the
  container; they show up without a restart).

### Configuration

All of these are optional; `.env.example` has the defaults.

| Variable | Default | What it does |
| --- | --- | --- |
| `APP_PORT` | `8080` | Host port. Container always listens on 8080. |
| `PUBLIC_ORIGIN` | *(derived)* | Set this behind a reverse proxy so shared links use your public hostname. |
| `MAX_UPLOAD_MB` | `25` | Upload size limit. |
| `LIBRARY_DIR` | `/app/data/library` | Where files live inside the container. |

### Behind a reverse proxy

TabJam needs WebSocket upgrades passed through — that's the only requirement.
`docker-compose.yml` has a commented Traefik label block as an example; any
proxy works.

---

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

---

## Not built (and why)

- **Multiple simultaneous audio devices.** Two people monitoring through their
  own amps needs real synchronized audio start across independent Web Audio
  contexts on separate machines — NTP-style clock offset estimation, then
  scheduling playback at a computed future time. It's a genuinely different
  problem from cursor sync and would complicate the single-device path that
  works well. Deliberately left out.
- **Side-by-side track panes.** Selected tracks currently render stacked
  vertically via alphaTab's native multi-track layout. True split-screen panes
  (one alphaTab instance per track over a shared `Score`, in a responsive grid)
  is the natural follow-up.
- **Session persistence across restarts.** See the SQLite note above.

## Licence

MPL-2.0, matching alphaTab.
