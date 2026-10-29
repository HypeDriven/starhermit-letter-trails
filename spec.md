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
| Platforms | StarHermit engine 1.27.0 script game (host API 1.29, `engine.minor=29`): natively in the StarHermit client and in browsers through the engine's web runtime (desktop and mobile, portrait and landscape) |
| Rendering | `starhermit:scene` (three.js r185 model) — a 3D desk with box tiles, one directional key light, a baked letter atlas; all menus and the HUD are `starhermit:ui`, built every frame over the scene |
| Persistence | The engine save (`starhermit:storage` `saves`): one document holding the `lt:*` keys (settings, journey progress, best scores, daily streak, achievements, guest id), on the device and, signed in, in the cloud slot |
| Network | Optional. Platform calls only when signed in (save sync, score posting, leaderboard, invite link) plus the platform clock |

### File map

| Path | Owns |
|---|---|
| `starhermit.txt` | Manifest: entry `native/main.ts`, engine 1.27.0 / minor 29, capabilities `platform,storage,clipboard`, `control.*` and `engine.gamepad.*` defaults per action |
| `native/main.ts` | Entry: app state, round lifecycle (setup → tutorial → active ⇄ paused → results), selection from keys, pointer and touch drags, hints, the fixed-step clock, results, achievements, ranked posting, lifecycle (a hidden window pauses) |
| `native/screens.ts` | Every screen, the wide-layout rails, the compact tray and drawers, the announcement line and toast (`starhermit:ui`) |
| `native/render.ts` | The board on `starhermit:scene`: desk, paper, tiles with per-letter UVs into the atlas, pencils, selection ribbon, motes, sparkles, lights, camera framing, picking, the post chain per graphics tier |
| `native/quality.ts` | The look per graphics tier and level (the old presets and budgets) |
| `native/audio.ts` | Opus one-shots per event on the runtime's buses; the ambience rendered once into a looping clip |
| `native/platform.ts` | The save document (session.js view, foreign-save migration, conflict merge, legacy settings removal), player, invite link, platform clock, score posting through `score-script.js`, the board's top ten |
| `native/i18n.ts` | Locale from the runtime's interface language; `T` / `N` / `M` over `src/i18n.js`, `S` over `src/sh-strings.js` |
| `native/style.ts` | Registers `assets/ui-style.json`, the theme and serif font; the high-contrast tokens |
| `native/game.ts` | Typed facade over the shared `src/*.js` modules |
| `src/rules.js` | Pure deterministic rules engine: board generation, legality, commands, scoring, hashing, save migration |
| `src/content.js` | Themes, six word banks, 40 journey levels, daily/practice/challenge definitions, tutorial lessons, offline validator |
| `src/session.js` | Phase state machine, progress under the `lt:*` keys (through an injectable storage), achievements, streaks, replay envelopes and `replayVerify` |
| `src/store.js` | The save document: `normalize`, `mergeDocs` (two devices' merge), `readForeign` (the old cloud slot), `docStorage` (a localStorage-like view) |
| `src/i18n.js`, `src/locales/` | Localization core (`T`, `N`, `setLocale`) and catalogues keyed by the US-English text |
| `src/sh-strings.js` | Account strings in the nine locales |
| `src/util.js` | FNV-1a hash, mulberry32 PRNG, clock/date formatting, `utcDay` |
| `score-script.js` | StarHermit platform script (`server=`): range-checks a ranked round's total and posts it to the `high-score` board |
| `index.html`, `starhermit-files.json` | The engine's web loader and file index, written by `npm run package` (never edited by hand) |
| `assets/ui-style.json` | The UI styles, converted from `tools/ui-style.css` (`npm run css`) |
| `assets/textures/` | Baked letter atlases (per theme and cell size, plain and detailed), wood and paper textures (`npm run textures`) |
| `tests/rules.test.mjs`, `store.test.mjs`, `i18n.test.mjs` (+ `i18n-keys.mjs`) | `node --test` unit tests |
| `tests/native.mjs`, `tests/native/*.play` | Engine checks and play scripts (§14) |
| `tools/` | `package-web.mjs`, `css.mjs`, `bake-textures.mjs`, `gen-plays.mjs`, `board.mjs` (tile screen positions), `browser-play.mjs` (GPU Chrome check) |
| `sfx/` | 18 Opus one-shots plus manifests |
| `assets/keyart.webp`, `coverart.png`, `cover.jpg`, `icon.png` | Title key art, cover, icon |

---

## 2. Design pillars

**1. The board is a physical object, not a text grid.**
Tiles are boxes with thickness that lift 0.14 units when they enter a selection and settle back with
an exponential ease. Rules in: shadows, a fixed three-quarter camera, a red thread-coloured marker
line drawn on the desk under the trail. Rules out: flat CSS grids, tile spin/flip animations, any
camera the player can orbit — the framing is authored once in `frameCamera` (native/render.ts) so a diagonal
always reads as a straight line, never as perspective skew.

**2. Every rule is a pure function of a seed.**
`rules.js` imports nothing but `util.js`; board generation, legality, and scoring are total functions
over an immutable snapshot. Rules in: shared daily boards, replay envelopes `replayVerify` re-simulates,
hint and tutorial code paths that call the same `legalActions` the player's moves go through. Rules
out: rules that read the clock or `Math.random` directly, and any board the server could not rebuild
from `(seed, size, words)`.

**3. Keyboard play is a first-class input, not an accessibility bolt-on.**
Arrows move a cursor, Enter anchors a line, Enter confirms it — the same command reaches the engine
as a touch drag. Rules in: per-cell spoken announcements, a hint key, an escape that cancels before
it pauses. Rules out: any action reachable only by dragging, which is why the play scripts can solve a
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
mismatch. The platform `score-script.js` does not run it (it only range-checks); `replayVerify` is exercised by the unit tests.

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
completed (the Journey screen in `native/screens.ts`). Progress lives in `lt:journey`.

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

Actions (`control.*` / `engine.gamepad.*` in `starhermit.txt`; players rebind keys and pads in the
runtime's Options › Controls, or from Settings › Key bindings):

| Action | Keys | Gamepad | Response |
|---|---|---|---|
| `up` / `down` / `left` / `right` | Arrows | D-pad, left stick | Cursor steps, `uiMove` sound, cell letter + row/column announced; with a line anchored, the preview follows |
| `select` | Enter, Space | South (A) | First press anchors the line (`select` sound), second commits |
| `back` | Escape | East (B), Start | Cancels a selection; else pauses; in the pause menu resumes; closes How to Play / Settings |
| `hint` | H | North (Y) | A whole word line highlights for 2.5 s, `hint` sound, start cell announced |
| `camera` | C | West (X) | Re-frames the authored camera |

**Pointer and touch.** Press on a tile (mouse or finger) to start a trail (`tick` sound, the tile
lifts and glows); drag to extend it — the preview snaps to the straight line from the origin to the
tile under the pointer, non-aligned targets collapse it to the origin cell; release to commit (word
found: colour + `wordFound`; rejected: `invalid`, a 400 ms flash, then clear). A release under
12 logical px and 350 ms from the press with one cell selected is a cancel, not a one-letter
selection (the rules would reject it as `too-few-cells`, costing the clean bonus); a cancelled touch
cancels the trail. Presses are decided after the frame's UI is built: presses on the rails, the
tray, a drawer or its scrim belong to the UI.

**Buttons.** Every button takes the pointer, touch, Tab + Enter and the pad (the runtime's focus).
Wide layouts show Pause, Hint (H) and Reset Camera (C) in the status rail; compact layouts show
Words, Hint, Pause and Status in the bottom tray. After a HUD button the focus is let go, so the
arrows and Enter return to the board (from host API 1.29 they stay the game's while no widget has
focus).

**Input locking.** Board input acts only while a round is active (not in the tutorial, pause or
results); the round's actions ignore a key the runtime's text capture holds. A hidden window (the
runtime's `onSuspend`) pauses an active round. F1 belongs to the runtime (Options).

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

Screens (`native/screens.ts`, immediate mode, built every frame): **Title** (key art under a scrim;
Play, Daily Challenge, Journey, Practice, Challenge, How to Play, Settings, Sign in with StarHermit
when signed out, Invite a friend when signed in; the player line with sync status), **mode setup**
(label, description, the board's facts as a term/value list, Start / Back), **Journey** (40 level
buttons in an auto-filling grid, ★ on mastery levels, done levels in the accent colour, locked ones
disabled; each button's accessible name says "Level n, completed / locked"), **Practice** (Easy /
Medium / Hard), **Challenge** (three constrained boards), **How to Play** (four rule cards with the
effective keys, plus pads and touch), **Settings** (Open Options and Key bindings into the runtime's
Options, Replay Tutorial, Done), the **tutorial** cards over a lighter wash, the **pause** menu
(Resume, Settings, Help, Leave Round) and the **results** (score breakdown, time, invalid
selections, new best, the challenge constraint, achievements, the leaderboard line and top ten;
Retry, Next Level / Play Again, Menu). Each screen opens at its top and focuses its primary
button; menus and dialogs are centred panels at most 560 px (92 % of the width on phones) that
scroll inside when taller than 85 % of the window.

**Layout.** Picked by the window's logical size (safe area excluded). **Wide** (≥ 1024 px): the
objective and word list in a 220 px rail on the left, the status (score, time, challenge limits)
and its buttons in a rail on the right, both full height and scrolling inside when needed; the
polite announcement line at the bottom centre. **Compact** (< 1024 px, phones in either
orientation, small windows): the tray (Words, Hint, Pause, Status; buttons up to 140 px wide) along
the bottom; Words and Status open drawers (up to 80 % of the width, 320 px) over the board above the
tray, each with a ✕ close button, and a scrim whose tap closes them; the announcement line sits in a
dark box above the tray; the camera frames the board in the height the tray leaves. Larger text
(the runtime's interface size) scales everything; panels wrap and scroll rather than clip.

**Safe areas.** Placed UI sits inside the runtime's safe area; the tray's backdrop extends under the
bottom inset.

---

## 8. Art direction

**Palette.** UI (`tools/ui-style.css`): paper `#f3ead7`, ink `#2b2b2f`, accent `#b3543f`, desk
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
border, tiles as 0.86 × 0.18 × 0.86 boxes (rounded at detailed quality) on a 1.0 pitch, resting on a paper sheet. Decorative pencil cylinders are scattered
deterministically from the board seed outside the play area and are never raycast.

**Typography.** The UI draws in the generic serif face (the browser build's Georgia); tile letters
are a baked 8 × 4 atlas (bold Georgia at 0.66 of the cell, cells of 128–384 px by tier) sampled per
tile through its top-face UVs, so 81 tiles cost one texture. Word-list entries are bold with
1.92 px letter-spacing; found entries get a strikethrough, 55 % ink and a ✓.

**Motion.** Tile lift eases with `1 − e^(−12·dt)`; the selection ribbon is redrawn, never tweened;
drawers open at once. Reduced motion sets that factor to 1, so lifts snap instantly — state is
always readable without animation, and no information is carried by motion alone.

**The hero** of the screen is the board: the UI is deliberately quiet — muted paper rails, no
gradients, no shadows besides the panel drop shadow — so the lit tiles are the only thing with depth.

**Visual assets the design calls for**: title key art of the physical fantasy (a real desk, blank
tiles, a red thread trail), and a matching 16:9 cover. Both ship (§15). No in-game sprites or 3D
props are needed beyond the procedurally built desk.

**Lighting.** Directional key `#fff2dd` at 2.1 intensity from above-right, its shadow frustum fitted
to the board and pencils, plus a `#f8f4ea`/`#40342a` hemisphere fill (0.85, or 0.5 when reflections
add image-based light). ACES filmic tone mapping and sRGB output. Fog in a darkened desk colour
starts about one board span behind the board, measured from the camera, so tiles never wash out at
any aspect ratio.

**Graphics.** The tiles rest on a paper sheet laid on a desk in the theme's desk colour; the
background is the same colour, darkened. With **detail** on, tiles are rounded boxes (clear-coated
physical material on High/Ultra), the letter atlas has paper grain, a soft edge falloff and a
letterpress highlight under each glyph, the desk has wood grain, the paper a fibre texture, and
pencils gain a sharpened wood tip and lead. The atlases, wood and paper are baked images
(`tools/bake-textures.mjs` runs the browser build's canvas painters in Chrome) for the three board
themes the content uses (classic, ocean, forest); each tile shows its letter through its own
top-face UVs into the atlas. **Reflections** give each lit material a PMREM-filtered
`RoomEnvironment(renderer)` as its `envMap`, with per-material strength. The selection preview is a
soft glowing ribbon on the paper under the selected line. **Particles** add dust motes over the
board and a sparkle burst from each found word; both stop under the runtime's reduced motion. Post
effects are the renderer's: ambient occlusion, bloom (threshold 1.0: only the trail, sparkles and
bright highlights), a display-space colour grade (gentle S-curve, +7 % saturation, warm highlights /
cool shadows, 0.2 vignette) and FXAA / SMAA / MSAA.

**Graphics levels.** The runtime's Options › Graphics chooses the level (Auto by default, from the
device); its quality tier selects the look below and the level scales the sparkles within the tier
(≤ 2×). The runtime owns render scale, the pixel-ratio cap, adaptive resolution, the frame-rate
limit and readout and the shadow-map cap. The board (keeping found words) is rebuilt when the
tier's budget changes.

| Tier | Shadows | AO | Bloom / grade | AA | Reflections | Detail | Particles | Materials | Atlas cell | Wood / paper | Bevel segments | Sparkles / motes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Low | off | off | off | MSAA | off | plain | off | Lambert | 128 px | — | — | — |
| Balanced | 1024² | off | on | FXAA | on | detailed | low | Standard | 192 px | 512 px | 2 | 0.75× / 0.75× |
| High | 2048² | on | on | SMAA | on | detailed | high | Physical | 256 px | 512 px | 3 | 1× / 1× |
| Ultra | 4096² | high | on | MSAA | on | detailed | high | Physical | 384 px | 1024 px | 4 (12-sided pencils) | 1.5× / 1.5× |

Every tile draws in two groups (all side faces with the shared edge material, the top face with its
letter material).

---

## 9. Audio direction

**Mix philosophy.** Wooden, dry, close-mic'd — a quiet room with tiles on paper. Nothing sustains
long enough to mask the next action; a fast drag must be able to tick every 60 ms without smearing.

**Buses** (`native/audio.ts`): the runtime's `effects` (game events), `interface` (the back
click) and `music` (the ambience); its Options own the volumes, mute and voice limit.

**Music and ambience.** There is no music track. Ambience is lowpassed noise (320 Hz) whose level an
0.11 Hz LFO swells by ±0.02 around 0.05, rendered once into one seamless LFO cycle (a clip made a
slice per frame) and looped on the music bus at 40 % while a round is active; it stops on pause,
completion and leaving.

**Sample playback.** Each event maps to a rotation of Opus one-shots, loaded one at a time once the
mixer runs (natively at once, in browsers after the first press); a clip still loading is silent
(the browser build's procedural stand-ins are not ported: a live synthesis graph makes clip loads
fail on the web runtime).

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

Haptics are not driven (§17).

---

## 10. Localization

The product requirement is en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT.

Every player-visible string is drawn through `T('<US-English text>', vars)` (`native/i18n.ts` over
`src/i18n.js`) each frame, in the locale nearest the runtime's interface language
(`preferences().language`: the player's choice in Options › Language, else the account's preferred
language or the device's); a change shows on the next frame and never touches the round.
Catalogues in `src/locales/` are keyed by the US-English text (en-US is the identity, en-GB lists
spelling changes, es-ES and fr-CA list their differences from es-419 and fr-FR). Lessons, challenge
and practice labels, achievements and theme names translate at display time; screen titles are
`[key, vars]` pairs. The How to Play cards keep their authored `<strong>` / `<kbd>` markup as keys:
the lead-in draws bold and each `<kbd data-key>` shows the action's effective keys. Account strings
(sign in, invite, toasts, "Playing as", the leaderboard line) come from `src/sh-strings.js`.

Word banks are English words and are content, not UI copy: the letters on the board *are* the
puzzle, so every locale plays the same English boards with translated theme names (§17).

---

## 11. Accessibility

* **Keyboard and pad path.** Every screen and every action, including a complete board solve
  (arrows + Enter, or the D-pad + A), works without a pointer; the play scripts solve whole boards
  this way.
* **Focus.** Each screen focuses its primary button when it opens; focus rings are 3 px at 2 px
  offset in the focus colour (orange under high contrast).
* **Screen reader.** The runtime's UI reaches screen readers. Polite announcements (cursor position,
  finds, progress, pause/resume, hints, the board's size and word count at the start) also show for
  5 s as the announcement line; rejections and the final score are assertive and not shown.
  Journey level buttons carry "Level n (mastery), completed / locked" names; the drawers' close
  buttons and scrim are named "Close word list" / "Close status".
* **Contrast.** Ink on paper is roughly 13:1; the runtime's high contrast option switches the UI to
  black on white with a blue accent and an orange focus ring. Found words are marked by
  strikethrough and ✓ as well as by colour.
* **Reduced motion.** The runtime's option snaps tile lifts and stops dust motes and sparkles.
* **Larger text.** The runtime's interface size scales the whole UI; panels and rails scroll.
* **Target sizes.** Every button is at least 44 × 44 logical px.

---

## 12. StarHermit integration

`starhermit.txt` declares `name`, `description`, `owner`, `server=score-script.js`, `cover=cover.jpg`,
`launch=index.html` (the engine's web loader), `engine.entry=native/main.ts`,
`engine.version=1.27.0`, `engine.minor=29`, `engine.capabilities=platform,storage,clipboard`, and the
`control.*` / `engine.gamepad.*` defaults of §6.

* **Player** — signed in, the title shows "Playing as <display name> · <sync status>"; a guest sees
  "Playing as Guest (local guest)" and **Sign in with StarHermit** (`requestSignIn`). When the
  session ends the game toasts "signed out" and keeps playing and saving on the device.
* **Save** — the engine save is the browser build's `lt:*` document (§13), on the device at once and
  in the account's cloud slot (debounced by the runtime). **Old cloud saves**: the slot the browser
  build wrote (`game:<slug>`, the JS SDK's JSON) shows as foreign; it is merged with the device's
  document (`mergeDocs`) and replaced once (`replaceForeign`). **Conflicts** between devices merge
  the same way: union of completed journey levels, achievements with the earliest unlock, the larger
  word total, the best score per mode, the more recent daily streak, this device's settings and
  guest profile. Guests' old browser `localStorage` progress cannot migrate (a different store).
* **Legacy settings** — the browser build's account settings keys (volumes, reduced motion,
  contrast, colour vision, larger text, left-handed, hold-to-confirm, haptics, graphics,
  `tutorialDone`, `ui.language`) are the runtime's Options now and are removed; a finished tutorial
  carries over into the save.
* **Leaderboard** — every finished ranked round (Play, Journey, Daily) signed in posts its total
  through `score-script.js` (a practice session carrying `{ type: 'result', scores }`; the script
  range-checks it into the `high-score` board, integer, higher is better, 0–100,000). The results
  then show "Leaderboard rank: #N" (or posted / not posted) and the board's top ten with display
  names. Practice and Challenge post nothing; personal bests stay in the save. Results are
  server-authoritative in the sense of the platform policy: the client only offers a total, the
  script decides what is recorded.
* **Daily** — the day comes from the platform clock (`serverNow()`), falling back to the device's
  UTC clock offline.
* **Invite** — signed in, **Invite a friend** copies the invite link (clipboard) with a toast.
* **Options** — sound, graphics, language, controls, accessibility and problem reports are the
  runtime's Options (Settings › Open Options, or F1).

**Not used.** Rooms, matchmaking, chat, replays and platform achievements: Letter Trails is
single-player with a shared daily seed. Achievements stay in the save.

---

## 13. Technical architecture

**Modules.** The pure game modules (`src/rules.js`, `content.js`, `session.js`, `store.js`,
`util.js`, `i18n.js`) are ES modules the engine imports directly (`allowJs`) and node tests import
unchanged; `native/*.ts` is the client. `rules` → `util` only; `content` → `rules`, `util`;
`session` → `rules`, `content`, `util`.

**Determinism.** State snapshots are cloned on every command and hashed with FNV-1a over a
canonical JSON projection. The round clock advances 1/60 s per runtime fixed step while the round is
active and is folded into the command log as `tick` commands in 5 s chunks (and on pause), so pauses,
a hidden window and slow frames never cost time, and play scripts replay exactly.

**Persistence.** `session.js` reads and writes its six `lt:` keys (`settings`, `journey`,
`achievements`, `best`, `streak`, `guest`) through an injected localStorage-like view of the save
document (`store.docStorage`); `native/platform.ts` saves the document at the end of any frame that
changed it. States carry `version` and go through `MIGRATIONS` on load.

**Performance.** `size²` tile meshes sharing per-letter copies of one two-group geometry and one
edge material, one atlas texture, two lights, one ribbon and at most two point clouds. Board
rebuilds dispose the previous desk, paper, pencils, particles and tiles. Per-pixel canvas work is
baked offline; the only runtime canvases are the 64 px soft dot and the 256 × 64 ribbon.

---

## 14. Testing and acceptance criteria

**`npm test`** runs:

* `npm run test:unit` (`node --test`): `tests/rules.test.mjs` (deterministic generation; legal
  actions; every rejection reason; reversed words; scoring; the terminal state; serialization and
  migration; identical hashes across runs; `validateContent()` across all journey levels, seven
  dailies and the challenges; the 03:00 UTC daily rollover; a malformed-command fuzz),
  `tests/store.test.mjs` (the old cloud slot read, normalisation, the two-device merge, session.js
  over the document view, the daily streak) and `tests/i18n.test.mjs` (every key from `src/` and
  `native/` in all nine locales with matching placeholders and inline markup, no stray keys).
* `npm run test:native` (`tests/native.mjs`): the web index matches the files, `tsc` (strict, no
  `skipLibCheck`), `starhermit check .` with zero warnings, and each `tests/native/*.play` as a
  signed-out `--render-check`: `menus.play` (desktop: every title door, the Journey grid, Practice,
  Challenge, the Daily setup, How to Play, Settings, a Practice round with a hint, pause, Help and
  Settings from the pause menu, leaving), `journey-1.play` (desktop: the tutorial's four lessons,
  the board solved by keys, the results with First Trail, the next level, leaving) and
  `challenge-phone.play` (390 × 844: the Move Limit challenge with both drawers, a hint, an invalid
  line, pause, the board solved by keys, the results with the move limit met). The board scripts are
  generated from the rules (`npm run plays`).

**Browser check.** `npm run test:browser` (`tools/browser-play.mjs`) serves the package on loopback
and plays Journey level 1 in Chrome on the GPU at 1366 × 768 (keys, then a mouse drag across the
last word), 390 × 844 at DPR 3 and 844 × 390 at DPR 3 (every word by a finger's swipe, the Words
drawer by taps), failing on console errors or warnings, the runtime's error screen, or a view that
does not reach the results.

**After every change:** `npm run package` (the loader refuses a stale file index).

---

## 15. Asset inventory

| Path | Purpose | Source |
|---|---|---|
| `assets/keyart.webp` | Title-screen backdrop (1280×720) | FLUX.2 klein render, WebP q80 |
| `coverart.png`, `cover.jpg` | Launcher cover | Same render with the title composited |
| `icon.png` | App icon | Authored |
| `sfx/*.opus` | The nine events of §9 (18 files) | MOSS-SoundEffect v2.0 |
| `assets/textures/atlas-*`, `wood-*`, `paper-*` | Letter atlases, desk wood, paper | Baked from the browser build's canvas painters (`tools/bake-textures.mjs`) |
| `assets/ui-style.json` | UI styles | Converted from `tools/ui-style.css` |
| Desk, paper, tiles, pencils | The 3D scene | Built in code (`native/render.ts`) |

---

## 16. Known limitations

* **Practice boards are not reproducible** — seeded from `Math.random()` by design.
* **Hints are unlimited and unpenalised**, which makes any board solvable without reading it.
* **Achievements are local to the save** (no platform entitlement).
* **Camera is fixed.** `C` re-frames it; there is no orbit or zoom, so a 9×9 board in a narrow
  portrait window is small; in a short landscape phone window the bottom row sits close to the
  announcement line.
* **The browser build's colour-vision, left-handed, hold-to-confirm and haptics settings** were
  stored but never read; they are not offered (the runtime's Options cover contrast and motion).
* **Pointer drags are checked in the browser only**: the 1.27.0 runtime's play scripts have no
  drag step, so native scripts play by keys.
* **Ranked posting** offers the client's total to `score-script.js`, which range-checks it; there is
  no server-side replay of the command log.

---

## 17. Design intent not yet implemented

1. **Per-language word banks** so the puzzle itself is localized; the UI is localized, the words
   are English.
2. **Colour-vision palettes** for the board themes.
3. **Haptics** on a found word.
4. **Platform achievements** mirroring the five local ones.
5. **Music bed** — a low, sparse room-tone melody, to be authored once it does not compete with the
   tile ticks.
