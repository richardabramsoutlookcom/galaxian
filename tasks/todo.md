# Galaxian — build plan

## Plan

- [x] Scaffold `galaxian-arcade/` on the frogger/oids pattern (native-res
      framebuffer, generated single-file HTML, headless preview)
- [x] Extract sprites, font and palette from the arcade sprite sheet
- [x] Framebuffer renderer: `fill` / `blit` / centred `blitC` / `text` / `mirror`
- [x] Starfield — scrolling, twinkling, multi-coloured
- [x] Screen layout: header, playfield, status row (reserve ships + stage flags)
- [x] 46-alien formation, 2/6/8/10/10/10, with horizontal sway
- [x] Dive AI: peel out, weave toward the player, fire, wrap at the bottom,
      re-enter at the top, fly home to the slot
- [x] Heading-driven sprite banking, mirrored for the opposite side
- [x] Flagship convoy: recruit two red escorts, 150/200/300/800 scoring
- [x] Combat: one player shot, three enemy shots, collisions, explosions
- [x] Stage progression and difficulty ramp
- [x] Web Audio: thrum, dive whine, shot, explosions, jingles
- [x] Attract mode: title, score-advance table, self-playing demo
- [x] High score in localStorage
- [x] Two-player alternating
- [x] Headless rule checks
- [x] Verify in a real browser
- [x] README with an honest fidelity split

## Round 2 — attack patterns from the ROM

- [x] Find and read a commented disassembly of the arcade ROM
- [x] Replace the invented homing-steering dive with the machine's real model
- [x] Correct the playfield geometry against the ROM
- [x] Regression tests for the flight model

**The source.** Scott Tunstall's commented Z80 disassembly at
<http://seanriddle.com/galaxian.asm> — 8,300 lines. Everything below is read
out of it; ROM addresses are cited in the engine next to each piece.

**What was wrong.** The first version steered each diver toward a weaving point
near the player at a capped turn rate. That is not how Galaxian works at all,
and it read as too twitchy and too eager. The machine's divers **commit**:

- Aliens are not picked at random. The code walks in from the leftmost or
  rightmost *occupied* column and takes the topmost available alien there,
  purple before blue; reds only join once the flagships are gone. The flank
  follows the swarm's sway.
- The peel-off is a 51-entry table that makes the alien *climb* 16px and shift
  32 sideways in a half-loop — mine dived immediately, with no climb at all.
- The dive is a flat 1px/frame descent with the horizontal offset driven by a
  fixed-point circle generator (`h += l/128; l -= h/128`) about a fixed pivot,
  giving a cosine. The radius is set once at launch and never revisited.
- Bombs are released at *exact* descent heights (157, less multiples of 25),
  not on a random roll — that is why real Galaxian fire feels learnable.
- The sprite points **at the player**, not along its own velocity, using a
  24-step angle built from seven quarter-turn sprites with horizontal *and*
  vertical flips. The vertical flip was missing entirely, which is why aliens
  could not properly face back up the screen during the peel.

**Geometry was measurably off.** The ROM puts swarm rows at y = 40..100 and the
player's ship at y = 224..239. Mine had the formation at 50..110 and the ship at
214, so the gap between them was 104px instead of 132px — which is exactly the
"feels a little short" the user reported before I had checked. Row pitch (12px)
and column pitch (16px) turned out already correct.

**Bug found and fixed.** An escort updated before its flagship could not see the
leader's sweep yet, so it computed a path of its own and the convoy broke apart.
Flagships now move first, and the sweep is published on the group. Pinned by a
test asserting the convoy's offsets stay rigid for the entire run.

**Also corrected.** Divers were bailing off the sides far too early: the machine
keeps that coordinate in a byte, so there is ~32px of room past each edge and a
wide swing can carry an alien off-screen and back. Fixing the margin took the
proportion of sorties that actually reach the player from 3-in-16 to 7-in-10.

**Verification.** 51 checks passing, stable over 10+ consecutive runs. The dive
paths were also plotted directly to an image and eyeballed: the peel-off loop,
the cosine sweep converging on the player, the near-bottom acceleration and the
straight-down return each show up exactly as the disassembly describes.

## Round 3 — GALAXIANS 2026

- [x] Version chooser at boot, persisted, with a live preview
- [x] Route rendering and audio through a skin so the simulation is untouched
- [x] Modern renderer: vector ships, nebula, parallax stars, trails, particles, bloom
- [x] Modern audio: reverb/delay bus, layered effects, synthwave soundtrack
- [x] Prove the two versions are the same game

**Shape of the change.** `update()` was not touched. Everything new hangs off
two seams: `A()` picks a sound bank, and `render()` dispatches to either the
arcade framebuffer or `Neo`. The modern renderer reads a plain snapshot of
state passed to it and never reaches into the simulation.

**Two bugs worth recording.**

1. *Particles aged in the wrong place.* They spawned from `update()` but were
   advanced in `render()`. The main loop can run several updates per draw, so
   effects piled up — the first playtest screenshot was a wall of white
   explosions. Moved to `Neo.step()`, called once per simulation frame.

2. *The renderer was stealing the simulation's dice.* Particle spawning called
   `Math.random()`, which consumes the same stream `maybeLaunch()` draws from —
   so the 2026 version was quietly playing a *different* game to the 1979 one.
   Gave the renderer its own LCG. This is the kind of thing that would never
   show up as a visible bug but breaks the whole premise, so there is now a
   test that diffs 2,400 frames of seeded play across both skins, plus one that
   greps the renderer for `Math.random`.

**Also tuned.** First pass had the bloom at 0.72 and the nebula at 0.55, which
washed the frame out completely; both roughly halved, and the explosion rings
and sparks were shrunk by about half. Version selection lives in its own mode
so the boot screen previews whichever option is highlighted.

**Cost.** 0.18 ms per frame with a busy screen against a 16.7 ms budget, so
there is a lot of headroom. The built file went from 63 KB to 113 KB, still
self-contained with no external references.

## Round 4 — vector version and per-level soundtracks

- [x] Third skin: phosphor vector renderer, sharing the 2026 audio
- [x] Data-driven music with six tracks, one per level
- [x] Extend the identical-simulation proof to all three skins

**Vector.** First attempt was wrong in a way worth writing down: I drew the
alien as three overlapping outlines (body + two wings + antennae) at 18px wide,
against a swarm laid out on a **16px column pitch**. They physically overlapped
and the thick halo filled them in, so the screen read as neon mush. The fix was
subtraction — one closed silhouette of eleven points, sized to 10.4px so it sits
inside the grid, and a hairline 0.42px core with a 1.15px halo at 13%. Vectrex
is sparse because the beam has to travel; the density has to reflect that.

Two other things that mattered: the HUD was being drawn onto the persistent
beam layer, so phosphor decay smeared the score into a ghost — text now goes on
after the composite. And `poly()` sets `globalAlpha` per stroke, which silently
overrode the caller's fade, so the "escorts down first" row in the score table
wasn't dimming; that now goes through an explicit multiplier.

**Soundtracks.** The sequencer was one hardcoded progression. It is now a table
of six tracks — key, tempo, four-bar progression, lead motif, drum feel, bass
accents — selected by stage and cycling. Tempo is per-track, so the delay time
has to be re-synced on every change. The retro build gets no-op `setTrack` /
`trackName` so the engine can call them unconditionally.

**The menu could not reach the third version.** Reported from actual play, not
caught by any test. The key handler still had `S.selIdx = 1 - S.selIdx` — the
two-option toggle written when there were only two versions — so arrowing
flipped 0↔1 forever and never reached index 2, even though the entry was drawn
on screen. Now a proper modular cycle in both directions.

The reason the suite missed it is instructive: every version test called
`applySkin()` directly, so it exercised the *mechanism* and never the *input
path*. There are now four tests that drive `onKey` itself — arrowing down
through every version and wrapping, arrowing up the other way, `V` cycling from
the attract screen, and Enter keeping whatever was highlighted.

**Test coverage gap found.** The headless sandbox has no `document.createElement`,
so both modern renderers early-return and are never really exercised — a stale
`ALIEN_BODY` reference survived a green test run and only failed in the browser.
Worth remembering that the render tests prove "doesn't throw at the seams", not
"draws correctly"; the browser pass is what actually checks the renderers.

**Cost.** Vector runs at 0.09 ms/frame, 2026 at 0.18 ms, against 16.7 ms.

## Round 5 — GALAXIAN X

A fourth version: landscape, fullscreen, power-ups, skill levels, a deeper
soundtrack. The 1979 flight model is kept exactly — X is a *presentation plus
rules layer* over the same simulation, not a new game.

**Decisions taken with the user.** Cockpit-widescreen layout (playfield keeps
its 224×256 geometry, scaled to screen height, with the scene running full-bleed
behind angled HUD wings). Neon-hyperreal art direction.

- [x] Engine: fourth skin `x`, fullscreen canvas path, `MODE.SKILL`
- [x] Engine: rules layer gated behind `xr()` so classic skins are untouched
      — power-ups, multi-shot weapons, shield, combo multiplier, skill tiers
- [x] `S.pshot` becomes an accessor over `S.pshots[]` so multi-shot is possible
      without forking the collision code
- [x] `src/x.js` — fullscreen landscape renderer: full-bleed backdrop, planet,
      5-layer parallax, containment rails, cockpit HUD wings, two-pass bloom,
      chromatic aberration, smoke/embers/debris explosions
- [x] `src/neoaudio.js` — X soundtrack: sectioned arrangements, sidechain duck,
      16th bass patterns, counter-melody, fills, filter automation
- [x] Build + template slots, README, tests
- [x] **Escalation** (asked for mid-build): a three-slot pod hold cycled with
      `C`, spent with `X` — and every pod spent hands the swarm an upgrade
- [x] **Rebindable keys** (asked for after): an action layer over the raw key
      codes, a two-slot-per-action editor on `K`, persisted

**Constraints that must hold.**

- 2,400-frame byte-identity across `retro` / `neo` / `vector` must still pass.
- X's own randomness (power-up drops) must never touch the simulation stream
  when a classic skin is live.
- `src/x.js` must never call `Math.random`, same rule as the other renderers.

## Round 5 review

**Shape of the change.** The same two seams the 2026 build introduced carried
X without modification: `renderer()` picks the module, `A()` picks the sound
bank. Two new seams were needed. A renderer can now declare `FULL = true`,
which makes `applySkin` size the backing store to the window and put `.full`
on `<body>` instead of using the fixed 224·RES × 256·RES buffer. And every rule
X adds is written as an explicit branch on `xr()` — never as an arithmetic
tweak to the shared path — so the classic versions execute the same
instructions rather than "the same sum, times one".

**Landscape without touching the geometry.** The playfield keeps 224 × 256,
because that is where the ROM's numbers live. The screen is divided into
playfield, a gutter each side wide enough for a diver's full sweep, and a
cockpit panel outside that. The gutter is the part worth having: the machine
keeps the across-screen coordinate in a byte, so a wide swing carries a diver
~32px past the edge and back, and on a widescreen monitor you can finally see
that happen instead of having it cropped.

**Four bugs worth recording.**

1. *`newPlayer()` ran before `S` existed.* X reads the skill tier to decide
   starting ships, so `newPlayer` now touches `S.skin` — but it was being
   called inside the `S = {...}` literal itself. Instant TDZ crash on load.
   The first player is now built on the line after `S`.

2. *Every sprite was baked at half scale.* The bake convention is REF device
   pixels per **game** pixel, so a shape written as `1.1 * k` with `k = REF*n`
   occupies `1.1*n` game pixels. The first pass used `n = 2.5` for an alien
   that wants to be 11px wide. Invisible in isolation, obvious next to the
   16px column pitch — the swarm looked sparse and the ship looked like a
   speck. Named constants now, with the arithmetic written down.

3. *The corridor wash was lifting the playfield instead of sinking it.* A
   navy fill at 0.8 alpha over a near-black sky is **brighter** than the sky,
   so the playfield read as a pale rectangle pasted over the scene. It has to
   darken: black at partial alpha, with the rail spill narrowed from 26 game
   px to 13 so it stops washing the whole lane.

4. *The wordmark's X sat on top of the N.* The offset was eyeballed as a
   multiple of the font size, but the font is whatever the system supplies and
   its widths are not knowable in advance. Measured with `measureText` and laid
   out properly.

**Reported from play, and it was a design fault not a bug.** "Selecting a power
up isn't making the power up do anything." The mechanism was working — the
problem was that `C` only moves the highlight and a second key spends the pod,
and that second key was my addition rather than something asked for. Cycling
and spending genuinely have to be separate (if `C` did both you could never
look through the hold without emptying it), so the fix was to bind the spend
generously — `X`, `Z`, `Enter`, `Shift` — and to stop hiding it: a pulsing key
badge reading `X  USE RAPID` under the hold, the keys on the READY screen, on
the attract screen, and in the page's help row.

**The headless test gap from round 4, closed.** The note above says the render
tests only proved "doesn't throw at the seams" because the sandbox has no
`document.createElement`, so the renderers early-returned and were never
exercised. There is now a second sandbox that hands out recording 2D contexts,
so every drawing call in neo, vector and x really runs — at ultrawide, 16:9,
4:3 and portrait, since X lays itself out differently in each and folds its
panels away on the narrow one. That is what caught the half-scale sprites
surviving a green run.

**Rebindable keys.** The input path used to compare `e.code` against literals
in a dozen places, which was tolerable with six keys and not with ten. It now
goes through actions: `bound('fire', code)` for presses, `held('left')` for the
per-frame check, and a table of two key slots per action behind both. The
prompts read from the same table, so rebinding the hold to `N` makes the
cockpit panel say `N CYCLE` — no string anywhere names a key.

Two things were worth being careful about. A code may only drive one action, so
setting a binding takes it away from wherever it was; leaving an action unbound
is allowed and shown in red rather than silently refused. And the editor answers
only to raw arrows / `Enter` / `Escape`, never to the bindings — otherwise
binding `Enter` to FIRE would make the editor unusable and there would be no way
back. That last one has a test that hands every navigation key to a game action
and then drives the editor with them anyway.

One ordering trap: the binding tables are declared in the input section, below
`S`, so `S.binds = loadBinds()` cannot run beside the `S` literal — `const`
tables are still in their temporal dead zone there. The binds load in the boot
block instead, and the accessors read as unbound until then.

**Verification.** 144 checks passing. The 2,400-frame byte-identity across
retro/neo/vector still holds, and there are now five checks in the other
direction: no pods drop, the one-shot rule holds, shield charges are ignored,
plating never applies, and the skill tier does not move the difficulty curve —
all under the classic skins. Then driven in Chrome: version select, skill
select, real keyboard play on ACE, the hold, the escalation ledger, armour
plating, and every mode screen. 0.44 ms per frame on a 3420 × 1696 backing
store, no console errors over a 3,000-frame soak.

## Review

**What was built.** `galaxian.html` — one self-contained 53 KB file, no external
references of any kind. Source in `src/`, build pipeline in `build/`.

**The find that shaped the project.** The pre-existing `galaxian/` folder held a
loose earlier attempt, but its `assets/sprites.png` turned out to be a genuine
rip of the arcade graphics — 15 colours, all authentic Namco hardware values.
That moved the whole job from "draw something Galaxian-ish" to "extract the real
thing", so `build/extract.py` pulls out 52 sprites and a 37-glyph font
pixel-for-pixel. Two things were nearly missed in that sheet: the misc band does
*not* follow the 17px cell pitch the other bands do, and hidden inside it are the
**stage flags** (both the single pennant and the "10" flag), which the plan had
assumed would need drawing by hand.

**Bug found and fixed during verification.** `S.timer` was doing double duty as
both the current-mode countdown and the attract demo's clock. Because the
`READY → PLAY` transition leaves `S.timer` at zero, the demo bailed straight back
to the title screen the moment its first wave was cleared. Caught by
instrumenting `startAttract` in the live page after a scripted play session
returned a suspicious `score: 0, alive: 46`. Fixed with a separate `S.demoLeft`
counter, and pinned with a regression test.

**One flaky test, and it was the test's fault.** "a fresh wave of 46 appears"
failed about one run in eight. Not a game bug: the check sampled the alien count
400 frames after the stage cleared, by which point a diver had sometimes traded
itself against the parked ship — which is correct Galaxian behaviour, a diver
that reaches you takes you both out. The assertion now samples the wave the
moment it is laid out. Stable over 30 consecutive runs.

**Also corrected along the way.** The attract-mode pilot was too timid to hit
anything (fired only when aligned within 2px and only on one frame in eleven);
rewritten it now scores ~4,000 and clears stage 1. Early-stage dive pressure was
raised from one diver to two. The header blink was moved from the score to the
`1UP`/`2UP` label, which is what the cabinet actually blinks.

**Verification.** `build/selftest.js` — 40 checks, all passing: the 46-alien
census by colour and row, all seven formation/diving point values, all four
flagship escort outcomes including the 800 jackpot, the one-shot rule, the
three-bullet cap held across 4,000 frames of play, dive wrap-and-return,
extra life at exactly 7,000 and only once, stage progression refilling to 46,
and the demo regression. Then driven live in Chrome: keyboard control confirmed
(left, right, fire), no console errors, every audio node builds, two-player
turn-passing keeps scores and lives separate, and the stage-13 status row
correctly shows one "10" flag plus three pennants.

**Known limits.** The dive curves, the starfield sequence, the attract wording
and all the audio are reconstructions, not the machine's own — each is called
out explicitly in the README rather than passed off as extracted.
