# Galaxian — a pixel-faithful homage, in four skins

A recreation of the 1979 Namco arcade **Galaxian**, built as a study project,
in four presentations over one simulation:

- **GALAXIAN 1979** — the arcade original at its native **224 × 256**, one game
  pixel to one canvas pixel, with the extracted ROM sprites and a chiptune.
- **GALAXIANS 2026** — everything visual and audible thrown away and rebuilt:
  shaded ships with baked glow, a drifting nebula, parallax starfield,
  light-ribbon trails behind every diver, particle explosions with shockwaves,
  a bloom pass, and a synthwave soundtrack.
- **GALAXIANS VECTOR** — a phosphor XY display. No fills anywhere: hairline
  outlines with a faint halo, short beam persistence so movement smears, and
  explosions that come apart into tumbling line fragments. Vectrex-sparse
  rather than neon-thick. Shares the 2026 audio.
- **GALAXIAN X** — landscape, full-screen, and the only version that changes
  the rules: four skill tiers, power-up pods held three at a time, and a swarm
  that upgrades itself every time you spend one.

The simulation underneath is **byte-identical** across the first three — same
flight paths, same scoring, same timings. The build asserts this: 2,400 frames
of seeded play are compared frame-for-frame under each and must match exactly.
X shares that same flight model verbatim and layers its rules on top; the tests
check both that those rules work under X and that they are completely inert
under the other three.

Non-commercial. Galaxian is a trademark of Bandai Namco; this is a hand-built
homage, not a port, and contains no ROM data.

---

## Play it

Double-click **`galaxian.html`**. That's it — one self-contained file, no
install, no server, no network access. Works in Safari, Chrome, Firefox.

It boots on a version chooser. Moving the cursor switches the whole
presentation live, so you can see each one before committing; the choice is
remembered.

| Default key | |
|---|---|
| `←` `→` | move (`A` / `D` also work) |
| `Space` or `Ctrl` | fire |
| `C` | cycle the pod hold — **GALAXIAN X only** |
| `X` or `Z` | spend the selected pod — **GALAXIAN X only** |
| `1` / `2` | start one- or two-player |
| `↑` `↓` + `Enter` | choose version, on the boot screen |
| `←` `→` + `Enter` | choose skill, on X's launch screen |
| `V` | switch version from the attract screen |
| `P` | pause |
| `M` | sound on/off |
| `K` | **key bindings** — every row above is rebindable |

Click the page once before playing — browsers won't start audio until you do.

**Keyboard only.** There are no touch controls, so it renders on a phone but
cannot be played on one.

### Hosting it

The repo is ready to deploy to Vercel as-is: point a project at it, take every
default, and it works. There is no build step, no framework and no serverless
function — the whole game is one static 247 KB file with no external references
and no network calls of any kind.

`vercel.json` rewrites `/` to `/galaxian.html` so the root serves the game, and
`.vercelignore` keeps `src/`, `build/` and `tasks/` out of the upload; they stay
in the repo but there is no reason to put them on a CDN.

One thing to know: high scores and key bindings live in `localStorage`, which is
per-origin. Every Vercel preview deployment gets its own URL, so only the
production domain accumulates them.

### Rebinding

Press `K` from the boot screen or the attract screen. Every action gets two key
slots; arrows move the cursor, `Enter` listens for the next key you press,
`Backspace` clears a slot, `R` restores every default and `Escape` goes back.
The choice is remembered.

Nothing in the game asks "was that the X key" — it asks "was that the USE POD
action", and the table answers, so the on-screen prompts change with the
bindings too: rebind the hold to `N` and the cockpit panel starts reading
`N CYCLE`. A key code can only drive one action, so binding it somewhere takes
it away from wherever it was, and the row it was taken from turns red until you
give it something.

The editor itself answers only to the raw arrow keys, `Enter` and `Escape`,
never to the bindings — so there is no way to rebind yourself out of being able
to reach it and put things back. There is a test for exactly that.

---

## How faithful is it?

**Taken pixel-for-pixel from the arcade original**

- **Resolution** — 224 × 256 portrait, the cabinet's native mode.
- **Palette** — all 12 colours sampled from the arcade graphics, and they are
  genuine Namco hardware values: the levels are 0 / 91 / 133 / 195 / 217 / 224,
  never arbitrary. Red `#E00000`, alien purple `#8500D9`, hull white `#C3C3D9`,
  cockpit cyan `#00C3D9`, flagship yellow `#E0E000`.
- **Sprites** — all 52 of them, extracted and re-emitted as pixel arrays: every
  alien in all three colours with its three wing-flap frames and six banking
  frames, the flagship's head-on pose and six banks, the player's ship and its
  death frame, the player's yellow 1×3 shot and the enemy's grey one,
  four alien explosion frames, four 32×32 player-death frames, the stage flags
  (both the single pennant and the "10" flag), and the magenta **150 / 200 /
  300 / 800** score labels.
- **Font** — the whole character set lifted from the arcade's own glyphs. It
  contains exactly `0-9`, `A-Z` and `-` and nothing else, which is why the
  attract screen reads `1979 NAMCO LTD` with no © symbol — the machine simply
  has no such glyph.
- **The formation** — 46 aliens, arranged as the cabinet arranges them:

  ```
  row 0    2 flagships          columns 4-5
  row 1    6 red                columns 2-7
  row 2    8 purple             columns 1-8
  rows 3-5 10 blue each         columns 0-9
  ```

- **Scoring** — straight off the cabinet:

  | | in formation | diving |
  |---|---|---|
  | blue | 30 | 60 |
  | purple | 40 | 80 |
  | red | 50 | 100 |
  | flagship | 60 | 150 / 200 / 300 / 800 |

  The flagship is the whole game: **150** if it comes down alone, **200** with
  one escort still flying, **300** with two, and **800** if you shoot both
  escorts first and only then the flagship. The escorts are two red aliens
  taken from the row below at the moment the flagship launches.

- **Rules** — exactly one player shot on screen at a time; at most three enemy
  shots (later-ROM behaviour); the formation sways at the top and never
  descends; a diver that passes the bottom of the screen reappears at the top
  and flies back into its own slot; three lives; extra life at 7,000 points
  (the cabinet's DIP default — 10,000 and 20,000 were the other options).
- **Status row** — reserve ships bottom-left, stage flags bottom-right, a "10"
  flag for each ten stages and a pennant for each one.
- **Playfield geometry** — read out of the ROM rather than eyeballed. The swarm
  rows sit at y = 40, 52, 64, 76, 88 and 100 (`X = 124 - row*3/4`), columns are
  16px apart, the player's ship is drawn as 2×2 tiles at tile row 28 so it
  occupies y = 224–239, and the status row is tile row 30, y = 240–255.

### The attack patterns

These are the part most clones get wrong, so they were taken from the code
rather than from watching videos. An attacking alien runs a seven-stage state
machine, and **it does not home in on you** — it commits to a path at launch.

- **Who attacks.** Never a random alien. The machine walks in from the leftmost
  or rightmost *occupied* column and takes the topmost available alien there,
  preferring purple, then blue. Red aliens only join the attack once every
  flagship is gone. Which flank is used depends on where the swarm has swayed
  to: near an edge it comes from that side, otherwise it is random.
- **The peel-off.** A 51-entry table of `[vertical, horizontal]` steps drives a
  little half-loop: the alien *climbs* 16 pixels and shifts 32 sideways while
  its sprite rotates through twelve steps, coming out of the roll pointing down
  the screen.
- **The dive.** The alien then descends at a flat 1 pixel per frame while its
  horizontal offset from a fixed pivot is swung by a fixed-point circle
  generator (`h += l/128; l -= h/128`), so the path is a cosine. The radius is
  chosen once, at launch, as `|distance to player| / 2 + 16` clamped to 48–112,
  and aimed so the swing carries the alien across the player. It never adjusts
  again. Wide swings routinely carry a diver off the side of the screen and
  back — the machine keeps that coordinate in a single byte, giving about 32
  pixels of room past each edge.
- **Sweep rate by row.** Each swarm row has its own rate: the purple row swings
  hardest, the blue rows least, so different aliens carve visibly different
  arcs.
- **The convoy charge.** The flagship's two escorts copy its sweep exactly, so
  the three fly as one rigid shape until each independently hits the
  near-bottom line at y = 184 and accelerates.
- **Bombing.** Divers do not fire at random. A bomb is released only when the
  alien's descent reaches an exact height — 157, or that less a multiple of 25
  — which is why Galaxian's fire is so sparse and so learnable. The number of
  release points grows as the top rows are cleared.
- **Shock.** Shoot a flagship in flight and the whole swarm is too rattled to
  launch anything for a moment.
- **Facing.** The sprite points at the player, not along the flight path,
  quantised to the machine's 24-step angle and built from seven quarter-turn
  sprites with horizontal and vertical flips.

**Reconstructed by hand** (drawn or written in the same style, not copied)

- **The starfield.** The cabinet generates its stars in hardware from a long
  shift register. This walks a 17-bit maximal LFSR once at load to place the
  stars, then scrolls and twinkles them. Same behaviour, not the same sequence.
- **The attract screens** — the title page wording and the score-advance table
  layout. The score *values* are the cabinet's; the presentation is mine, and
  the table deliberately shows the flagship with two live escorts and then with
  two dead ones, because that is the rule worth teaching.
- **The demo pilot** that plays the attract mode.
- **All audio** — the pulsing background thrum that speeds up as the wave is
  cleared, the dive whine, the shot, the explosions, the jingles. Synthesised
  from oscillators and filtered noise, by ear. No samples, no ROM audio, and
  not a model of the cabinet's sound circuit.
- **Difficulty pacing.** The *structure* is the machine's — a base value that
  steps up per level and an extra value that creeps up during a level, both
  capped at 7, together setting how many attackers fly at once (1–4, plus a
  flagship and its escorts). The exact rates at which those counters move, and
  the delay between launches, are tuned by feel rather than measured.

**Deliberately not included:** cocktail-cabinet screen flip, the DIP-switch
service menu, and coin handling.

---

## Layout reference

```
y   0..  7   1UP        HIGH SCORE        2UP     (the active player's label blinks)
y   8.. 15   scores
y  16..239   playfield
             swarm rows at y = 40 52 64 76 88 100, columns 16px apart
             divers accelerate at y = 184, drop bombs at y = 157 and 132
             player's ship spans y = 224..239
y 240..255   reserve ships (left)            stage flags (right)
```

## GALAXIANS 2026

The remaster shares the simulation and replaces everything else. None of the
arcade art is reused — not upscaled, not filtered, not referenced. The ships
are drawn as vector forms and baked once into offscreen canvases with their
glow already burned in, then rotated and blitted, so the per-frame cost stays
tiny.

- **Ships** — swept-wing interceptors with gradient hulls, emissive cores and
  antennae, one silhouette family per tier so the blue/purple/red/flagship
  hierarchy still reads at a glance. The player's ship gets a cockpit, twin
  thruster plumes and a bank when it moves.
- **Rotation** — the machine's 24-step facing is smoothed into continuous
  rotation, so ships bank fluidly through their arcs instead of snapping.
- **Trails** — every diver drags a tapered light ribbon. This is the part
  worth watching: it draws the cosine sweep the ROM actually flies, so the
  attack geometry becomes visible.
- **Explosions** — expanding shockwave rings, a core flash, colour-tinted
  sparks with drag, and tumbling debris shards. Player deaths add screen shake
  and a red frame flash.
- **Background** — a pre-baked multi-layer nebula scrolling under a
  three-layer parallax starfield, with the near layer streaking.
- **Post** — the frame is composed offscreen, downsampled, blurred and added
  back for bloom, then vignetted.
- **Sound** — a bus with convolution reverb (procedural impulse response) and
  a tempo-synced feedback delay. Layered effects: swept-saw lasers, explosions
  built from a sub-bass thump plus filtered noise, a doppler-ish dive whine.
- **Soundtrack** — an original synthwave loop sequenced live at 132 BPM in A
  minor: detuned saw bass, sixteenth arpeggios through the delay, pads, drums,
  and a lead that only enters once the wave is thinning. Its intensity is
  driven by how much of the wave you have cleared, exactly where the original
  build ramps its heartbeat thrum.

Each modern renderer keeps its **own random stream** rather than drawing from
`Math.random`, because sharing it would consume the sequence the simulation
uses and the versions would stop playing identically. There is a test for that
too.

Measured at **0.18 ms per frame** for a busy screen, against a 16.7 ms budget.

## GALAXIANS VECTOR

The same game again on an XY monitor. The discipline here is subtraction:

- **One closed outline per object**, a handful of segments each — the wings and
  antennae are folded into a single silhouette rather than drawn as extra
  strokes. A Vectrex frame is sparse because the beam has to physically travel.
- **Hairline strokes.** A 0.42px core with a 1.15px halo at 13% — the halo is
  what makes it read as light instead of ink. Push either up and the shapes
  fill in and turn white.
- **Sized to the pitch.** The swarm sits on a 16px column and 12px row grid, so
  the aliens are drawn 10.4px wide and never touch their neighbours. Getting
  this wrong was the first thing that looked broken.
- **Phosphor persistence.** The beam layer is never cleared, only faded 52% per
  frame, so fast movement leaves a short decaying trail. The HUD is drawn
  *after* the composite — put text on the persistent layer and it smears into
  an unreadable ghost.
- **Explosions** are tumbling line fragments and an expanding polygon ring —
  a polygon, not a circle, because vector hardware had no curves.

Measured at **0.09 ms per frame** on a busy screen.

## GALAXIAN X

The fourth version is the landscape one, and the only one that is not just a
new coat of paint. The **flight model is shared verbatim** — same launch order,
same 51-entry peel-off arc, same cosine sweep about a fixed pivot, same bombing
heights, same rigid convoy. Everything X adds sits behind one predicate in the
engine (`xr()`), so the other three take the code path they always did.

### Landscape without touching the geometry

The playfield is where the ROM's numbers live, so it keeps its 224 × 256 shape.
What changes is everything around it. The backdrop — planet, nebula, five-layer
parallax starfield, drifting dust — runs edge to edge across the window. The
playfield sits in the middle as a lit **containment corridor** with energy rails
carrying travelling scan segments. Outside each rail is a **gutter** wide enough
for a diver's sweep to carry it clear of the corridor and back, which is exactly
what the arcade's single-byte across-screen coordinate allows: on a widescreen
monitor you can finally *see* the part of the attack that the cabinet cropped.
Outside the gutters are the cockpit panels.

The layout is computed per frame from the window size. Below roughly 1.15:1 the
panels have nowhere to go, so they fold into slim strips at the top and bottom
and the playfield takes the space instead. Both branches are tested at
ultrawide, 16:9, 4:3 and portrait.

### Power-ups, and what they cost

A kill can leave a pod behind. Picking one up does **not** spend it — it goes
into a three-slot **hold**. `C` cycles the hold, `X` spends the selected pod.

| Pod | |
|---|---|
| **BEAM UP** | permanent weapon tier: single → twin → triple spread |
| **RAPID** | shorter cooldown and two more bolts in the air, for a while |
| **SHIELD** | a charge that soaks one hit; two can be stacked |
| **DOUBLE** | doubles scoring on top of the skill multiplier, for a while |
| **NOVA** | everything currently in the air dies at once |

And here is the bargain: **every pod you spend hands the swarm an upgrade of its
own**, drawn from a different pool, never the same one twice running.

| Swarm upgrade | |
|---|---|
| **BARRAGE** | a higher bomb cap and more release heights per dive |
| **SWARM** | more attackers allowed in the air at once |
| **VELOCITY** | faster bombs and a shorter delay between launches |
| **VANGUARD** | flagships launch far more often |
| **ARMOUR** | hull plating: aliens take two or three hits, and re-plate on the spot |

So the hold is a real decision rather than a pickup counter. Sitting on three
pods keeps the swarm where it is; cashing one in for a triple beam buys you
firepower and buys them BARRAGE. A fourth pod collected with a full hold is
banked as points rather than lost. Dying costs a weapon tier and the timed
pickups, but never the hold.

Kills also build a **combo** that lapses if nothing dies for about three
seconds, multiplying score up to ×8.

### Skill

Four tiers, chosen on their own screen before a run: **ROOKIE**, **PILOT**,
**ACE**, **LEGEND**. Each sets starting ships, how many attackers fly at once,
the enemy bomb cap and speed, the launch delay, flagship frequency, pod drop
rate — and a score multiplier from ×1 to ×5, so a LEGEND run is worth chasing.
X keeps its high score in its own slot rather than flooding the arcade table.

### The look

Neon hyperreal, and heavier than the 2026 skin everywhere: sprites baked at
eight device pixels per game pixel with rim light and a separate canopy,
two-pass bloom, chromatic aberration that only fires while something is
exploding, screen shake, elliptical shockwaves, tumbling debris, and smoke that
lingers after the sparks have gone. The wave-clear stretches the starfield into
a warp. The cockpit panels carry the score, the loadout, the hold, the swarm's
upgrade ledger, the wave, the combo and a live analyser.

Measured at **0.44 ms per frame** on a 3420 × 1696 backing store, against a
16.7 ms budget.

## Soundtracks

The two modern versions get **six original tracks**, one per level, cycling
after the sixth. Each is a different key, tempo, chord progression, lead motif
and drum feel, so levels sound genuinely different rather than just faster:

| | | |
|---|---|---|
| NEON DAWN | 132 BPM | A minor |
| HYPERDRIVE | 144 BPM | D dorian |
| ION STORM | 124 BPM | C phrygian |
| STARFALL | 152 BPM | E minor |
| EVENT HORIZON | 116 BPM | F# minor |
| OVERDRIVE | 160 BPM | G phrygian |

All sequenced live from oscillators — detuned saw bass, sixteenth arpeggios
through a tempo-synced delay, pads, drums, and a lead that only enters once the
wave is thinning out. Track intensity is driven by how much of the wave you
have cleared, which is the same hook the 1979 build uses to speed up its
heartbeat thrum. The stage's track name is shown on the READY screen.

**GALAXIAN X gets eight of its own**, and a deeper arrangement to play them
with. The 2026 tracks are one four-bar loop that gets busier; these are
eight-bar forms that go somewhere:

| | | |
|---|---|---|
| EVENT ZERO | 128 BPM | A minor |
| MACH SEVEN | 150 BPM | D dorian |
| BLACK SIGNAL | 118 BPM | C phrygian |
| AFTERBURN | 158 BPM | E minor |
| SINGULARITY | 112 BPM | F# minor |
| TERMINAL VELOCITY | 168 BPM | G phrygian |
| LAST LIGHT | 138 BPM | D minor |
| GALAXIAN X | 146 BPM | A phrygian |

- A **section wheel** turns every two bars — intro, groove, lift, break — so
  layers come and go on the arrangement's clock as well as the wave's.
- The **bass runs a sixteenth pattern** of scale degrees rather than plain
  eighths, with a sine sub underneath it.
- A **sidechain duck** pulls the whole melodic bus down on each kick and lets
  it back up over an eighth. The game's own effects bypass it, so explosions
  are not ducked with the music.
- An **FM bell counter-melody** answers the lead in the gaps, because a second
  saw would just thicken the first.
- Drums are pattern strings with accents, open and closed hats, a ride, and a
  **tom fill plus reverse-cymbal riser** across the last half-bar of each phrase.
- Pads are **seventh chords** with filter opening on intensity.

The arcade version has no soundtrack, because the cabinet had none.

---

## Sources

The graphics came from a community rip of the ROM tiles and sprites. The
behaviour — the state machine, the arc table, the circle generator, the
formation and screen geometry, the bombing heights, the flank selection and the
difficulty counters — was read out of **Scott Tunstall's commented Z80
disassembly** of the Galaxian ROM, at <http://seanriddle.com/galaxian.asm>.
ROM addresses are cited in the source next to the code they explain.

---

## Building

`galaxian.html` is generated. To change anything, edit `src/` and rebuild:

```sh
python3 build/build.py        # -> galaxian.html
node build/selftest.js        # 144 rule checks
```

| Path | |
|---|---|
| `galaxian.html` | the game — generated, self-contained, the thing you run |
| `src/engine.js` | simulation, arcade renderer, version switching |
| `src/audio.js` | 1979 chiptune (hand-written) |
| `src/neo.js` | 2026 renderer — shaded art, particles, bloom |
| `src/vector.js` | vector renderer — phosphor beam, line debris |
| `src/x.js` | X renderer — landscape layout, cockpit HUD, bloom, CA |
| `src/neoaudio.js` | 2026 and X effects and soundtracks |
| `src/art.js` | sprite + font data — **generated**, don't edit |
| `src/index.template.html` | page shell |
| `build/extract.py` | pulls sprites, font and palette out of the sprite sheet |
| `build/gen_art.py` | extraction → `src/art.js` |
| `build/build.py` | inlines everything into `galaxian.html` |
| `build/selftest.js` | headless rule checks — the fidelity claims above |
| `build/preview.js` | headless renderer — dumps frames for pixel diffing |
| `build/ref/sprites.png` | the arcade graphics everything was measured from |

`extract.py` needs Python 3 with Pillow; `gen_art.py` and `build.py` need
nothing but the standard library.

### Headless rendering

`build/preview.js` runs the real engine against a stub canvas, so frames can be
inspected without a browser. It writes a binary PPM.

```sh
node build/preview.js 400 /tmp/f.ppm "startGame(false)"
node build/preview.js 30  /tmp/t.ppm "S.attractPage=1"     # the score table
```

Any argument after the filename is evaluated in the sandbox, so game state can
be posed directly — that is how the banking frames and the score-advance table
were checked.

### Tests

`build/selftest.js` asserts the things this README claims: the 46-alien census,
every point value, all four flagship escort outcomes, the one-shot rule, the
three-bullet cap, the 7,000-point extra life, stage progression, and that the
attract demo survives a cleared wave.

There is also a check that the versions are the same game: 2,400 frames of
seeded play are run under retro, neo and vector, and every alien position,
facing, state, bullet, score and life count must match exactly.  The
soundtrack selection is checked too: distinct named tracks, one per level,
cycling when the list runs out.

**GALAXIAN X is checked from both sides.** That its own rules work — four skill
tiers that actually move the difficulty curve, the three weapon tiers and their
bolt budget, the shield, the pod hold and its cycle/spend keys, every power-up
effect, ARMOUR plating, the combo — and that none of them leak: under retro,
neo and vector no pod ever drops across 3,000 frames, the one-shot rule still
holds, a shield charge is ignored, plating never applies, and the skill tier
does not change `diff()` at all.  The escalation has its own group: spending a
pod hands the swarm exactly one upgrade, never the same one twice running, it
stops once everything is maxed, and a fully upgraded swarm attacks harder on
every axis.

**Key bindings** get their own group: that rebinding an action really moves
both the press handler and the held-key check, that a code can only drive one
action so binding it steals it, that clearing and restoring work, that the
choice survives a reload and that a corrupt saved file falls back to defaults —
and the one that matters most, that the editor cannot be locked out. That test
hands every navigation key (`Enter`, `↑`, `↓`, `Escape`) to a game action and
then drives the editor with them anyway.

The renderers get a second sandbox that hands out recording 2D contexts, so
every drawing call in `neo.js`, `vector.js` and `x.js` really executes rather
than early-returning for want of a canvas — run at ultrawide, 16:9, 4:3 and
portrait, because X lays itself out differently in each and folds its cockpit
panels away below about 1.15:1.

The flight model gets its own checks, since that is where the fidelity lives:
that the peel-off climbs before it dives, that descent is a flat 1px per frame,
that the sweep radius is derived from the distance to the player and aimed
across them, that the alien crosses its pivot rather than homing, that the
convoy holds a rigid shape for the whole run, and that bombs are only ever
released at the ROM's exact heights.

```
144 passed, 0 failed
```
