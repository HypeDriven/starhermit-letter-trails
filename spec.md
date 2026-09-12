# Letter Trails — Game Design Document

Running specification. Present tense; describes the game as it ships today. Anything the design
intends but the code does not yet do is listed only in **Design intent not yet implemented**.

---

## 1. Overview

**Pitch.** A word search played on a lit desk: drag a straight trail of raised wooden tiles to lift
a themed word off the board, and clear every word before the desk clock runs long.

| | |
|---|---|
| Genre | Single-player word search / observation puzzle |
| Players | 1 |
| Session length | 1–5 minutes per board; ~8 minutes for a daily plus a journey level |
| Platforms | Browser, desktop and mobile (portrait and landscape), no install |
| Rendering | Three.js WebGL — a real 3D desk with box tiles, one directional key light, canvas letter atlas; all menus and HUD are DOM over the canvas |
| Persistence | `localStorage` (settings, journey progress, best scores, daily streak, achievements, guest id) |
| Network | Optional. Same-origin `/api/v1/*` on a StarHermit host; fully playable offline |

### File map

| Path | Owns |
|---|---|
| `index.html` | DOM shell: canvas, HUD rails, tray, all ten screens, CSS palette and responsive layout |
| `src/main.js` | Boot, capability check, input (pointer + keyboard), round lifecycle, glue between every module |
| `src/rules.js` | Pure deterministic rules engine: board generation, legality, commands, scoring, hashing, save migration |
| `src/content.js` | Themes, six word banks, 40 journey levels, daily/practice/challenge definitions, tutorial lessons, offline validator |
| `src/session.js` | Phase state machine, persistence, achievements, streaks, replay envelopes and `replayVerify` |
| `src/render.js` | Three.js scene: desk, tiles, letter atlas, selection lift, marker line, picking, quality tiers |
| `src/audio.js` | WebAudio buses, one-shot sample playback with procedural fallback, ambience loop |
| `src/platform.js` | Launch token (fragment, refreshed every 45 min), Bearer `/api/v1` client, profile nickname, cloud-save mirror, read-only leaderboards; dev-only server-time/scores/events |
| `src/ui.js` | DOM controller: screen switching, focus restoration, live regions, HUD, settings form |
| `src/util.js` | FNV-1a hash, mulberry32 PRNG, easing, clock/date formatting, `utcDay`, monotonic `now` |
| `server.js` | Static server + `/api/v1/time`, `/daily`, `/scores` (replay-validated), `/events` |
| `tests/rules.test.mjs` | 26 `node --test` cases over rules, content and determinism |
| `tests/e2e.mjs` | Playwright-core playthrough of the real UI at desktop and mobile |
| `tests/smoke.mjs` | Headless full-board playthrough with replay verification, prints state hashes |
| `sfx/` | 18 Opus one-shots plus `manifest.txt` (canonical), `manifest.json` (generator), `manifest.md` |
| `assets/keyart.webp` | Title-screen key art |
| `coverart.png` | 1200×675 store/launcher cover |
| `vendor/three.module.min.js`, `vendor/three.core.min.js` | Three.js r185, imported through the import map |

---

## 2. Design pillars

**1. The board is a physical object, not a text grid.**
Tiles are boxes with thickness that lift 0.14 units when they enter a selection and settle back with
an exponential ease. Rules in: shadows, a fixed three-quarter camera, a red thread-coloured marker
line drawn on the desk under the trail. Rules out: flat CSS grids, tile spin/flip animations, any
camera the player can orbit — the framing is authored once in `render.frameCamera` so a diagonal
always reads as a straight line, never as perspective skew.

**2. Every rule is a pure function of a seed.**
`rules.js` imports nothing but `util.js`; board generation, legality, and scoring are total functions
over an immutable snapshot. Rules in: shared daily boards, replay envelopes the server re-simulates,
hint and tutorial code paths that call the same `legalActions` the player's moves go through. Rules
out: rules that read the clock or `Math.random` directly, and any board the server could not rebuild
from `(seed, size, words)`.

**3. Keyboard play is a first-class input, not an accessibility bolt-on.**
Arrows move a cursor, Enter anchors a line, Enter confirms it — the same command reaches the engine
as a touch drag. Rules in: per-cell spoken announcements, a hint key, an escape that cancels before
it pauses. Rules out: any action reachable only by dragging, which is why the e2e test can solve a
whole board with the keyboard alone.

**4. Calm pressure.**
The clock scores, it never kills. Speed decays a per-word bonus by 1 point per 3 s and floors at
zero; nothing expires, no board is ever lost. Rules in: pause on backgrounding, unlimited retries,
unranked practice. Rules out: timers that end a round, streak-loss punishment, forced ads of urgency.

**5. Themed word lists that read like a place.**
Boards are drawn from six curated banks (ocean, forest, kitchen, space, music, garden), and the
theme also picks the palette. Rules in: short, concrete, spellable nouns. Rules out: dictionary
scraping, obscure words, and any word longer than the board it must fit on.

---

## 3. Player experience

**Target player.** Someone who plays word searches on paper or on a phone and wants the same
low-stakes hunt with better feedback and a reason to come back tomorrow.

**First 60 seconds.** The title screen shows the key art behind a paper panel with **Play** as the
primary button. Play resumes journey at the first uncompleted level and shows the mode card (board
size, word count, theme, par, ranked/unranked) before anything starts, so nothing begins by
surprise. Level 1 is a tutorial level: four lesson cards teach, one mechanic at a time — *trace a
line*, *words run both ways*, *eight directions*, *clean streaks* — each dismissible with "Got it"
and the whole sequence skippable. The board then appears with the word list already visible in the
left rail (a drawer on compact layouts) and the announcement "Round starting. Find all N words."
The first drag makes a tile tick, lift and glow; the first correct trail colours green, strikes the
word off the list, and plays a mallet run. That satisfies the QA bar's requirement that a new player
either gets clear instructions or is guided when a mechanic first appears.

**Typical session.** One daily (8 words on an 8×8, shared by everyone that UTC day), then one or two
journey levels. Practice is where players go to warm up; challenge is where they go when they want a
constraint to push against.

**Emotional beat.** The half-second between recognising a word in the letter noise and the tiles
lifting under the trail — the game is built to make that moment land physically and instantly.

---

## 4. Core loop and rules contract

Everything in this section is implemented in `src/rules.js` unless another file is named.

### Board and entities

* A board is a `size × size` grid of uppercase letters, `grid[r]` stored as a string per row.
* Each level carries a word list. `generateBoard(seed, size, words)` dedupes and uppercases them,
  drops anything that is not `/^[A-Z]{2,}$/` or longer than `size`, sorts longest-first, then places
  each word along one of the eight directions with up to 200 placement attempts, allowing overlap
  only where letters agree. Up to 64 whole-board attempts run with `mulberry(seed ^ imul(attempt+1,
  0x9e3779b9))`; the first attempt that places every word wins. Remaining cells are filled from
  `ETAOINSHRDLUCMFWGYPBVKJXQZ` (frequency-ordered, so filler letters look like English).
* `createState({seed, size, words})` returns the snapshot: `grid`, `words[{word, cells, found}]`,
  `tick`, `foundCount`, `invalidActions`, `streakClean`, `status`, `score`, `elapsedMs`,
  `streakClaimed`, `version: 1`.

### Legal actions

`legalActions(state)` returns one `{type:'select', cells, word}` per unfound word. Hints
(`main.giveHint`), the smoke test and the e2e test all read this same API — there is no privileged
path into the engine.

### Commands and resolution order

`applyCommand(state, cmd)` never mutates its input; it clones, applies, and returns
`{state, ok, reason}`. Three command types:

| Command | Validation, in order | Effect |
|---|---|---|
| `select` | status active → `cells` is an array → ≥2 cells → ≤ size² cells → every cell an integer pair → every cell in bounds → collinear with constant step (`isStraightLine`) → letters (or their reverse) match a listed word → that word is unfound | Marks the word found, `foundCount++`, adds score, resets `streakClean` |
| `tick` | status active (else a no-op `ok`) → `0 ≤ ms ≤ 600000` and finite | `elapsedMs += floor(ms)` |
| `claim-streak` | `days` integer in `[0, 366]` | Once per state: `streakBonus = days × 25`, `streakClaimed = true` |

Any rejection returns `ok:false` with a `REASONS` code, increments `tick`, `invalidActions` and
`streakClean`, and leaves everything else untouched. Unknown command types are rejected, not thrown:
`applyCommand` is total, and `tests/rules.test.mjs` fuzzes malformed commands to prove it.

### Scoring

```
wordPoints += 20 × word.length            per found word
cleanBonus += 50                          when streakClean === 0 at the moment of the find
speedBonus += max(0, 100 − floor(elapsedMs / 3000))
streakBonus  = dailyStreakDays × 25       once, via claim-streak
total = wordPoints + cleanBonus + speedBonus + streakBonus
```

**Worked example — journey level 1** (`SHELL, KELP, REEF, TIDE`, solved immediately with no invalid
selections, the exact board the e2e test plays): letters 5+4+4+4 = 17, so `wordPoints = 340`; four
finds each with `streakClean === 0` give `cleanBonus = 200`; at `elapsedMs ≈ 0` each find scores the
full 100, so `speedBonus = 400`; not a daily, so `streakBonus = 0`. **Total 940** — the number
`tests/e2e.mjs` prints from the results table.

### Terminal state

`finalize` recomputes `total` and, when `foundCount === words.length`, sets `status: 'complete'` and
`terminalReason: 'all-words-found'`. That is the only terminal state: there is no loss condition, no
move limit that ends a round, and no clock that expires. Challenge constraints (move limit, time
target) are evaluated for the results text in `main.finishRound` and never gate completion.

### Tie-breaks

Ranking happens server-side in `server.scoreCompare`: completed boards first, then higher score,
then fewer invalid actions, then lower elapsed time, then the stable submission id.

### RNG and seeding

`util.mulberry` (mulberry32) everywhere; seeds come from `util.fnv` over stable strings — journey
`fnv('letter-trails:journey:' + n) ^ (n × 7919)`, daily `fnv('letter-trails:daily:' + utcDate)`,
challenges `fnv('lt:challenge:' + name)`. Practice is the one deliberately random mode: it seeds
from `Math.random()` at pick time, so practice boards differ every attempt.

### Undo and hints

There is no undo — a rejected selection costs the clean bonus and nothing else, which is the
intended risk. **H** or the Hint button picks a uniformly random unfound word from `legalActions`,
highlights its whole line for 2.5 s and announces its start cell; hints are free and unlimited, and
carry no score penalty.

### Determinism and replay

Every command the player issues is appended to a replay envelope with the FNV hash of the resulting
state (`session.recordCommand`). `session.replayVerify` rebuilds the initial state from
`(seed, size, words)`, rejects duplicate command ids, re-runs the log, and fails on the first hash
mismatch. `server.js` runs exactly that check before a score enters the leaderboard.

---

## 5. Modes and progression

| Mode | Definition | Board | Words | Ranked | Notes |
|---|---|---|---|---|---|
| **Play** | Shortcut to the first uncompleted journey level | as that level | — | yes | The title screen's primary button |
| **Daily Challenge** | `content.dailyDefinition(utcDay)` | 8×8 | 8 | yes | One board per UTC day for every player; feeds the streak |
| **Journey** | `content.JOURNEY`, 40 authored levels | 6×6 → 9×9 | 4 → 10 | yes | Level grid with locks; ★ marks mastery levels |
| **Practice** | `content.practiceDefinition(diff, random)` | 6×6 / 7×7 / 9×9 | 5 / 7 / 10 | no | Fresh random board every time |
| **Challenge** | Three fixed constrained boards | 7×7 / 7×7 / 9×9 | 6 / 6 / 10 | no | Move limit, speed target, or both |

**Journey curve.** Size steps 6 (levels 1–8), 7 (9–20), 8 (21–32), 9 (33–40). Word count is
`min(4 + floor(i/4), 10)`. Theme cycles through the six banks. Every 8th level is a *mastery* level
and carries a move limit of `wordCount + 4`. Level 1 is the tutorial level. Par is
`wordCount + 3` moves and `60 s + size × wordCount × 8 s`.

**Unlocking.** A level is playable if it is level 1, already completed, or the level before it is
completed (`ui.renderJourneyGrid`). Progress lives in `lt:journey`.

**Daily and streak.** `util.utcDay` rolls the day at **03:00 UTC** using UTC getters only, so the
seed cannot drift with the client's timezone. Completing a daily calls `recordDailyCompletion`,
which increments the streak when the previous UTC day was the last completion, resets to 1
otherwise, and is idempotent for repeat plays on the same day. The resulting day count is fed back
into the command log as `claim-streak`, so the streak bonus survives replay validation.

**Achievements** (`session.ACHIEVEMENTS`, idempotent, stored in `lt:achievements`): First Trail
(first completion), Clean Hand (a mastery level with zero invalid actions), Steady Hand (3-day daily
streak), Deep Ink (complete hard practice), Century of Words (100 words found lifetime).

---

## 6. Controls and interaction

| Input | Desktop | Mobile | Response |
|---|---|---|---|
| Start a trail | Press pointer on a tile | Touch a tile | Tile lifts and glows, marker line appears, `tick` sound |
| Extend a trail | Drag | Drag | Preview snaps to the straight line from origin to the pointed cell; non-aligned targets collapse the preview to the origin cell |
| Commit | Release | Lift | Word found (colour + `wordFound`) or rejected (`invalid`, 400 ms red-hot flash, then clear) |
| Cancel | Release on the origin cell (tap) or `Escape` | Tap without dragging | Selection clears, "Selection cancelled." announced |
| Move cursor | Arrow keys | — | Cursor steps, `uiMove` sound, cell letter + row/column announced |
| Anchor / confirm line | `Enter` or `Space` | — | First press anchors (`select` sound), second commits |
| Hint | `H` / Hint button | Hint in the tray | A whole word line highlights for 2.5 s, `hint` sound, start cell announced |
| Reset camera | `C` / Reset Camera button | — | Re-frames the authored camera |
| Pause | `Escape` (with no selection) / Pause button | Pause in the tray | Pause dialog; `Escape` again resumes |
| Word list / status | Always-visible rails | Words / Status tray buttons | Slide-in drawers, mutually exclusive |

**Input locking.** Pointer and keyboard handlers return immediately unless `sess.phase === 'active'`,
so no board input reaches the engine while a menu, tutorial card or pause dialog is up. The canvas
uses pointer capture; `pointercancel` and `lostpointercapture` clear the selection rather than
committing a partial trail. Typing into settings inputs never reaches the game keymap. Backgrounding
the tab pauses an active round and suspends the audio context.

**Tap threshold.** A release under 12 px and 350 ms from the press, with only one cell selected, is
treated as a cancel, not a one-letter selection — the engine would reject it as `too-few-cells`
anyway, and that would cost the clean bonus.

---

## 7. Screens and UI flow

Phases live in `session.PHASES` and every transition is checked against the `ALLOWED` table, with an
explicit reason string:

```
boot → title → mode-select → preparing → [tutorial] → countdown → active ⇄ paused
                                                                    ↓
                                       progression ← results ← resolving
```

`results` can go back to `mode-select` or straight to `preparing` (Retry / Next Level); `paused`
can leave to `mode-select`. An illegal transition throws rather than silently corrupting state.

Ten DOM screens (`#screen-title`, `mode`, `journey`, `practice`, `challenge`, `pause`, `settings`,
`results`, `help`, `tutorial`) plus the HUD. `ui.showScreen` shows exactly one, moves focus to its
first button, and restores the previously focused element when it closes.

**Layout.** `#app` is a three-column grid — 240 px word rail, canvas, 240 px status rail — with a
bottom tray row. At ≤1023 px the grid collapses to one column, both rails become fixed 80vw-max
drawers that slide in from the sides, and the tray becomes the visible action bar (Words, Hint,
Pause, Status). Panels are `min(92vw, 560px)` wide and scroll internally at `max-height: 85vh`, so
no dialog is ever taller than the viewport.

**Safe areas.** `env(safe-area-inset-*)` is read into `--sat/--sab/--sal/--sar` and applied to every
screen's padding, both rails' margins and the tray. Nothing interactive sits under a notch, a home
indicator or browser chrome. Must never be cut off: the word list, the score/time readout, the tray
buttons, and every panel's action row.

**Failure screen.** With no WebGL context, `#compat` takes over with an explanation that local
progress is preserved, and boot stops before any 3D work.

---

## 8. Art direction

**Palette.** DOM shell (`index.html`): paper `#f3ead7`, ink `#2b2b2f`, accent `#b3543f`, desk
`#6b4f3a`, tile `#e8dcc0`, focus ring `#1a5fb4`. High contrast swaps to paper `#ffffff`, ink
`#000000`, accent `#0044cc`, tile `#ffffff`, focus `#ff8000`.

Five board themes (`content.THEMES`), each supplying paper / ink / tile / tileEdge / accent / desk /
found / marker:

| Theme | Desk | Tile | Accent | Found |
|---|---|---|---|---|
| Classic Desk | `#6b4f3a` | `#e8dcc0` | `#b3543f` | `#3f7a4e` |
| Ocean Ledger | `#274b5a` | `#d4e6ea` | `#1f7a8c` | `#2e8b6e` |
| Forest Press | `#3d4a2e` | `#dfe4c9` | `#4a7c3a` | `#2f6b4f` |
| Dusk Study | `#4a3448` | `#e3d3e0` | `#8c4a7a` | `#5a7a4a` |
| Night Ink | `#17181d` | `#2f3340` | `#d9a441` | `#6fae7f` |

**Shape language.** Rounded rectangles everywhere: 8 px buttons, 12 px panels with a 3 px ink
border, tiles as 0.86 × 0.18 × 0.86 boxes on a 1.0 pitch. Decorative pencil cylinders are scattered
deterministically from the board seed outside the play area and are never raycast.

**Typography.** Georgia / Times New Roman serif for the whole shell; tile letters are drawn once
into a 1024 × 512 canvas atlas at `bold 84px Georgia` and sampled per tile with UV offsets, so 81
tiles cost one texture. Word-list entries are bold with `0.12em` letter-spacing; found entries get
strikethrough, 55 % opacity and a ✓.

**Motion.** Tile lift eases with `1 − e^(−12·dt)`; the marker line is redrawn, never tweened;
drawers slide in 0.25 s. Reduced motion sets that factor to 1, so lifts snap instantly — state is
always readable without animation, and no information is carried by motion alone.

**The hero** of the screen is the board: the DOM is deliberately quiet — muted paper rails, no
gradients, no shadows besides the panel drop shadow — so the lit tiles are the only thing with depth.

**Visual assets the design calls for**: title key art of the physical fantasy (a real desk, blank
tiles, a red thread trail), and a matching 16:9 cover. Both ship (§15). No in-game sprites or 3D
props are needed beyond the procedurally built desk.

**Lighting.** Directional key `#fff2dd` at 2.4 intensity from above-right with a 1024² shadow map,
plus a `#f8f4ea`/`#40342a` hemisphere fill at 0.85. ACES filmic tone mapping, sRGB output, and fog
in the desk colour from 2.2× to 5× board span.

---

## 9. Audio direction

**Mix philosophy.** Wooden, dry, close-mic'd — a quiet room with tiles on paper. Nothing sustains
long enough to mask the next action; a fast drag must be able to tick every 60 ms without smearing.

**Buses** (`src/audio.js`): `master → {music, effects, ambience, voice}`, defaults 0.6 / 0.8 / 0.4 /
0.7, three of them exposed as sliders. The context is created only on the first user gesture
(`unlock`), and suspends on tab hide.

**Music and ambience.** There is no music track. Ambience is a synthesized 2 s looped noise buffer
through a 320 Hz lowpass with an 0.11 Hz LFO on its gain, started when a round becomes active and
stopped at completion or when leaving.

**Sample playback.** Each event maps to a rotation of Opus one-shots, fetched and decoded lazily
after unlock, deduped per file and retried on a later event if a fetch fails. Until a buffer is
ready the procedural fallback plays — one path or the other, never both — so a cold or offline start
is still fully audible. Samples route through `effectsBus`, so mute and volume apply to them.

### SFX event table

This table is the source for `sfx/manifest.txt`.

| Event id | Files | Description | Usage context |
|---|---|---|---|
| `tick` | `tile-tick-1/2/3.opus` | Soft dry wooden tile click | Pointer-down starting a trail |
| `select` | `select-confirm-1/2.opus` | Warm confirming pop / pluck | Keyboard line anchor set with Enter or Space |
| `invalid` | `invalid-thud-1/2.opus` | Dull wooden thud, gentle rejection | A committed selection is rejected by the engine |
| `wordFound` | `word-found-1/2/3.opus` | Ascending xylophone / marimba run | A trail matches an unfound word |
| `complete` | `round-complete-1/2.opus` | Mallet fanfare into a sustained chime | Final word of the board found |
| `uiMove` | `ui-move-1/2.opus` | Tiny dry tick | Arrow-key cursor step |
| `hint` | `hint-shimmer-1/2.opus` | Airy bell shimmer, unobtrusive | Hint requested with H or the Hint button |
| `achievement` | `achievement-1.opus` | Wooden stamp into a bright chime | One or more achievements unlock at round end |
| `uiBack` | `ui-back-1.opus` | Soft downward wooden knock | Closing help, returning to title, leaving a round |

Haptics are a stored setting (`haptics: true`) and are not yet driven (§17).

---

## 10. Localization

The product requirement is en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT.

**Today** every player-visible string is authored in US English inline: static copy in `index.html`,
dynamic copy in `src/ui.js` (HUD labels, results rows, mode facts), announcements and error
explanations in `src/main.js` (`explainReason`), and lesson text in `src/content.js` (`LESSONS`).
`<html lang="en">` is fixed. There is no string table and no language selector — see §17 and §18.

**Constraints the current UI already respects**, so a string table can land without relayout:
panels wrap and scroll rather than clipping, buttons size to content with a 44 px floor, and the
`larger-text` setting proves the layout survives a 120 % type ramp — enough headroom for the ~35 %
expansion German and French Canadian typically bring. Word banks are English words and are content,
not UI copy: a localized build needs per-language banks, not translations of the existing ones,
because the letters on the board *are* the puzzle.

---

## 11. Accessibility

* **Keyboard-only path.** Every screen is reachable and every action performable from the keyboard,
  including a complete board solve (arrows + Enter). `tests/e2e.mjs` solves both its passes this way.
* **Focus.** `ui.showScreen` focuses a panel's primary button on open and restores the previous
  element on close. Focus rings are 3 px at 2 px offset in `--focus`, which changes to orange under
  high contrast.
* **Screen reader.** `#live` (polite, also visible on screen as a status line) carries cursor
  position, finds, progress, pause/resume and hint text; `#live-assertive` (`role="alert"`,
  visually hidden) carries rejections and the final score. `#board-desc` describes board size, word
  count and how to move. The canvas is `aria-hidden` — it never holds information the DOM lacks.
* **Contrast.** Ink on paper is roughly 13:1; the High contrast setting takes it to black on white
  with a blue accent. Found words are marked by strikethrough and ✓ as well as by colour, and two
  colour-vision palettes are exposed as a setting (§17).
* **Reduced motion.** A setting, applied to tile easing and honoured by the render loop.
* **Larger text.** 120 % body scale, applied as a body class.
* **Target sizes.** Every button is at least 44 × 44 px, including range inputs and selects.
* **Left-handed** mode is a stored setting and a body class (§17).

---

## 12. StarHermit integration

`starhermit.txt` declares `name`, `launch=index.html`, `owner`, `server=server.js`,
`cover=coverart.png`, per https://wiki.starhermit.com/ conventions.

**Used (platform launch — a `#game_token=` fragment was read).**

* **Identity** — the launch token is read once from the `#game_token=` fragment
  (query `?token=` remains as a local-dev fallback), then stripped via
  `history.replaceState`; it is held in memory only (never persisted) and sent
  as `Authorization: Bearer` on every call. The payload supplies `sub` and
  `game_scope` (the slug, never hard-coded). Without a token the game runs as a
  locally stored guest profile.
* **Token refresh** — every 45 min the client POSTs the current token to
  `/api/v1/games/{slug}/launch-token` and swaps in the re-minted `{token}`;
  failures retry after ~60 s.
* **Profile** — `GET /api/v1/users/{sub}/profile` supplies the displayed
  nickname (`"Player " + id.slice(0,8)` fallback; usernames never shown);
  it renders in the title-screen profile line with the cloud sync status.
* **Cloud save** — one slot at `GET`/`PUT /api/v1/me/cloud-saves/{slug}`:
  the six `lt:*` game keys zip+base64'd (stored zip, no compression). The
  remote wins on load; local writes are mirrored back (~2 s debounce,
  `pagehide`/`visibilitychange` flush). localStorage stays the offline cache.
* **Leaderboards (read-only)** — `GET /api/v1/games/{slug}` gives the
  `leaderboardId`; `GET /api/v1/leaderboards/{id}/entries` renders the top 10
  on the results screen, userIds resolved to nicknames. Clients cannot submit
  scores; personal bests stay local (and cloud-mirrored). With no
  `leaderboardId`, local records only.

**Used (local dev only — own server.js, no token).** The `/api/v1/time` probe
(round-trip-adjusted daily boundary) gates the dev routes so an unhosted build
stays silent: `POST /api/v1/scores` (replay validated by re-simulation),
`GET /api/v1/scores?board=…`, and `POST /api/v1/events` telemetry (throttled,
queued to `lt:telemetry-queue`, capped at 50). None of these are requested on
a platform launch; platform mode uses the local clock for the daily boundary.

**Not used.** Presence, matchmaking, realtime sessions, friends and social
feeds: Letter Trails is single-player with a shared seed, so a daily
leaderboard is the whole social surface. Achievements stay local (part of the
cloud-saved doc); `server.js` is a plain Node server, not a Jint game script,
so there is no script-owned unlock path.

---

## 13. Technical architecture

**Dependency direction.** `rules` → `util` only. `content` → `rules`, `util`. `session` → `rules`,
`content`, `util`. `render` → `three`, `content` (palettes), `util`. `main` imports everything and
is the only module allowed to. No module reaches into the DOM except `ui`, `render` and `main`.

**Determinism.** State snapshots are cloned on every command, hashed with FNV-1a over a canonical
JSON projection with fixed key order. Identical seeds plus identical commands produce identical
hashes across processes — asserted by `tests/rules.test.mjs` and re-verified by the server.

**Persistence.** Six `localStorage` keys, all namespaced `lt:` — `settings`, `journey`,
`achievements`, `best`, `streak`, `guest`, plus `lt:telemetry-queue`. Every read and write is
wrapped: with storage unavailable the session runs normally and simply forgets. On a platform
launch these keys are also mirrored to the cloud-save slot (remote wins on load, §12).

**Save migration.** States carry `version` and go through `MIGRATIONS` on load; a newer-than-supported
version is rejected loudly rather than half-read.

**Performance budgets.** One draw-call-cheap scene: `size²` tile meshes sharing one geometry and one
edge material, one canvas atlas texture, three lights, one line. Quality tiers cap pixel ratio at
1 / 1.5 / 2 and toggle shadows; `auto` picks `low` when the smaller viewport axis is under 700 px.
The render loop allocates nothing per frame (scratch vectors are module-level) and clamps `dt` to
0.1 s. Board rebuilds fully dispose geometries, materials and textures. Rendering is skipped
entirely while the tab is hidden. The clock is folded into the command log in ~5 s chunks, so a
five-minute round adds about 60 commands to an envelope, not thousands.

**How the e2e test drives the real UI.** `tests/e2e.mjs` serves the repo on an ephemeral port with
stand-in `/api/v1` routes, launches system Chrome through `playwright-core`, and clicks the actual
buttons: settings toggle, help, Play, mode start, tutorial next/skip, then solves the board with
real arrow/Enter key presses, then exercises hint, pause, pause-settings, resume and leave on a
second round. It reads word coordinates by importing `src/rules.js` inside the page purely to aim
key presses; no game function is called to make progress. Any `pageerror` or non-GPU-noise console
error fails the run.

---

## 14. Testing and acceptance criteria

**`npm test`** (`node --test`, 26 cases in `tests/rules.test.mjs`) verifies: deterministic generation
that places every word; `legalActions` yields exactly the unfound words; every rejection reason
(non-straight, out-of-bounds, too-few, bad cells, no match, already found, not active, bad tick, bad
streak); reversed words match; scoring components and the total; the terminal transition and its
reason; serialize/deserialize hash round-trip; version-0 migration; rejection of garbage and future
versions; identical hashes across runs; different seeds giving different boards;
`content.validateContent()` clean across all 40 journey levels, seven simulated dailies and all
challenges; the content shape (5 themes, 6 banks of ≥12 words, ≥40 levels); daily determinism per
UTC date; the 03:00 UTC rollover independent of local timezone; and a malformed-command fuzz that
must neither throw nor hang.

**`npm run test:e2e`** must print `E2E OK` for both the 1280×800 desktop pass and the 390×844 touch
mobile pass, with zero console or page errors.

**`node tests/smoke.mjs`** plays journey 1, journey 40, today's daily and the tight-grid challenge to
completion through legal actions only, and asserts `replayVerify` accepts each log.

**QA bar, as checkable statements.**

1. A first-time player is taught trace, reverse, direction and clean-streak before their first free
   board (journey level 1 tutorial cards).
2. Every implemented feature is reachable in the browser: all five modes, hint, pause, settings,
   help, tutorial replay, journey level select, and the results actions.
3. Zero console errors or warnings at both viewports, hosted and unhosted — hosted mode is
   token-gated, the dev-only `/api/v1/time` probe keeps an unhosted build from ever requesting a
   missing route, and the only expected hosted-mode network miss is the documented 404 from the
   empty cloud-save slot.
4. No text or control is cut off at 1280×800 or 390×844, portrait or landscape: panels scroll
   internally, rails become drawers, and safe-area insets pad every edge.
5. Features that could use platform services do: launch-token identity with nickname and token
   refresh, cloud saves with remote-preferred load, read-only leaderboards against the script-owned
   board; validated replay submission and telemetry run against the local dev server.

---

## 15. Asset inventory

| Path | Purpose | Source | Status |
|---|---|---|---|
| `assets/keyart.webp` | Title-screen backdrop (1280×720, 61 KB) | FLUX.2 klein, 1536×864, seed 41733, 30 steps, then ffmpeg → WebP q80 | generated this pass, wired in `index.html` |
| `coverart.png` | Launcher cover, 1200×675 | Same FLUX render, scaled, title text composited with ffmpeg drawtext (DejaVu Serif), 192-colour palette, 337 KB | generated this pass; replaced a placeholder that did not match the art direction |
| `icon.png`, `favicon.svg` | App icon / tab icon | Authored | shipped |
| `sfx/tile-tick-1/2/3.opus` | `tick` | MOSS-SoundEffect v2.0 | shipped |
| `sfx/select-confirm-1/2.opus` | `select` | MOSS-SoundEffect v2.0 | shipped; newly bound to the keyboard anchor this pass |
| `sfx/invalid-thud-1/2.opus` | `invalid` | MOSS-SoundEffect v2.0 | shipped |
| `sfx/word-found-1/2/3.opus` | `wordFound` | MOSS-SoundEffect v2.0 | shipped |
| `sfx/round-complete-1/2.opus` | `complete` | MOSS-SoundEffect v2.0 | shipped |
| `sfx/ui-move-1/2.opus` | `uiMove` | MOSS-SoundEffect v2.0 | shipped |
| `sfx/hint-shimmer-1/2.opus` | `hint` | MOSS-SoundEffect v2.0, 100 steps | generated this pass, wired |
| `sfx/achievement-1.opus` | `achievement` | MOSS-SoundEffect v2.0, 100 steps | generated this pass, wired |
| `sfx/ui-back-1.opus` | `uiBack` | MOSS-SoundEffect v2.0, 100 steps | generated this pass, wired |
| Letter atlas | 26 glyphs on one canvas texture | Generated at runtime in `render.buildLetterAtlas` | procedural, no file |
| Desk, tiles, pencils | The entire 3D scene | Built procedurally in `render.buildBoard` | procedural, no model files |

No 3D model files and no character animation are called for: the board is the only geometry and it
is cheaper and sharper to build in code than to ship as a mesh.

---

## 16. Known limitations

* **English only.** All copy is inline English; no string table, no language selector (§10).
* **`colorVision`, `leftHanded`, `holdToConfirm` and `haptics`** persist and (for left-handed) apply
  a body class, but nothing currently reads them for layout, palette or vibration.
* **No music bus content.** The music slider affects a bus with no source on it.
* **Practice boards are not reproducible** — seeded from `Math.random()` by design, so a great
  practice board cannot be shared or replayed.
* **Hints are unlimited and unpenalised**, which makes any board solvable without reading it.
* **Achievements are stored locally**; on-platform they ride the cloud-save mirror once synced,
  but site data cleared before a sync still loses them, and there is no platform entitlement.
* **Camera is fixed.** `C` re-frames it; there is no orbit or zoom, so on a 9×9 board at a narrow
  portrait width the tiles are small (still legible at the atlas resolution, but tight).
* **`ui.closeSettings`** is dead code — the settings panel closes through `main`'s `settings-close`
  handler.

---

## 17. Design intent not yet implemented

1. **Localized string table** for the nine required locales, with the language chosen from the launch
   token, then `navigator.language`, then a settings override; per-language word banks so the puzzle
   itself is translated rather than the chrome around it.
2. **Colour-vision palettes** — the setting exists; the deuteranopia and tritanopia theme variants do
   not yet override `THEMES`.
3. **Left-handed layout** — the class is applied but no rule mirrors the rails or tray.
4. **Hold-to-confirm and haptics** — stored, not yet driven from the commit path.
5. **Platform achievements** — mirror the five local achievements to StarHermit once the game is
   granted an achievements scope.
6. **Music bed** — a low, sparse room-tone melody for the music bus, to be authored once it does not
   compete with the tile ticks.
