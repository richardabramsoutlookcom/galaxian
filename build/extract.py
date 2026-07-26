#!/usr/bin/env python3
"""Pull every sprite, the font and the palette out of the arcade sprite sheet.

The sheet (build/ref/sprites.png) is a community rip of the 1979 Namco ROM
graphics: 205x192, 15 colours, all of them authentic Namco hardware values.
Cells are 16x16 on a 17px pitch starting at x=1; the band tops are irregular
and so are hardcoded from measurement.

Output: build/ref/assets.json   { palette, sprites, font }

Every sprite is trimmed to its content bounding box and is drawn CENTRED on
the entity position by the engine, so the differing vertical placements the
ripper used from cell to cell wash out and animation stays stable.

Requires Pillow.  Only needs re-running if the sheet changes.
"""
import json
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REF = os.path.join(HERE, 'ref')
SHEET = os.path.join(REF, 'sprites.png')

# ---------------------------------------------------------------------------
# palette -- char -> RGB.  '.' is transparent and covers both the per-cell
# black backdrop and the sheet's own grey background.
# ---------------------------------------------------------------------------
PAL = {
    'r': (224, 0, 0),        # red        alien body / player trim
    'm': (195, 0, 217),      # magenta    explosions, score labels, logos
    'w': (195, 195, 217),    # white      player ship, font
    'c': (0, 195, 217),      # cyan       player ship, font
    'y': (195, 195, 69),     # dull yellow  alien eyes
    'b': (0, 0, 217),        # blue       alien wings
    'p': (133, 0, 217),      # purple     alien body
    't': (0, 133, 148),      # teal       blue-alien body
    'Y': (224, 224, 0),      # yellow     flagship, player shot
    'B': (0, 91, 217),       # light blue alien wings
    'o': (195, 62, 0),       # orange     flagship
    'G': (217, 217, 217),    # light grey enemy shot
}
TRANSPARENT = {(0, 0, 0), (48, 48, 48)}
# pure white is only used by the ripper's own annotation arrows/labels
IGNORE = {(255, 255, 255)}

RGB2CH = {v: k for k, v in PAL.items()}

# ---------------------------------------------------------------------------
# sheet geometry, all measured off the image
# ---------------------------------------------------------------------------
CELL = 16
PITCH = 17
X0 = 1

# band top -> (name prefix, number of 16x16 cells)
ALIEN_BANDS = [(1, 'red'), (17, 'purple'), (34, 'blue')]
BOSS_BAND = 52
BIGBOOM_BAND = 87         # 32x32 player-death explosion

# The misc band does NOT follow the 17px pitch -- the two stage-flag cells are
# 8 and 16 wide and packed tight -- so its cells are listed as (name, x, w).
MISC_BAND = 70
MISC_CELLS = [
    ('ship',       1, 16),   # player ship: white/cyan hull, red nose and spine
    ('ship_death', 18, 16),  # ship coming apart, first death frame
    ('flag1',      35,  8),  # stage marker worth 1
    ('flag10',     44, 16),  # stage marker worth 10
    ('boom0',      61, 16),
    ('boom1',      78, 16),
    ('boom2',      95, 16),
    ('boom3',     112, 16),
    ('score150',  129, 16),
    ('score200',  146, 16),
    ('score300',  163, 16),
    ('score800',  180, 16),
]

FONT_BANDS = [(120, 19), (129, 18)]
FONT_CHARS = '0123456789ABCDEFGHI' + 'JKLMNOPQRSTUVWXYZ-'
FONT_W = 8
FONT_PITCH = 9

# 1x3 shot sprites, isolated in the annotation column
PSHOT = (200, 97, 1, 3)
ESHOT = (200, 108, 1, 3)


def grab(px, x, y, w, h):
    """Read a w*h region as palette-char rows, '.' for transparent."""
    rows = []
    for j in range(h):
        row = []
        for i in range(w):
            c = px[x + i, y + j]
            if c in TRANSPARENT or c in IGNORE:
                row.append('.')
            else:
                row.append(RGB2CH.get(c, '.'))
        rows.append(''.join(row))
    return rows


def trim(rows):
    """Crop away fully-empty edge rows and columns."""
    if not rows:
        return ['']
    top = 0
    while top < len(rows) and set(rows[top]) == {'.'}:
        top += 1
    if top == len(rows):
        return ['']
    bot = len(rows)
    while set(rows[bot - 1]) == {'.'}:
        bot -= 1
    rows = rows[top:bot]
    left = min(len(r) - len(r.lstrip('.')) for r in rows)
    right = max(len(r.rstrip('.')) for r in rows)
    return [r[left:right] for r in rows]


def cell(px, band, i, size=CELL, pitch=PITCH):
    return trim(grab(px, X0 + pitch * i, band, size, size))


def main():
    im = Image.open(SHEET).convert('RGB')
    px = im.load()

    sprites = {}

    # --- aliens ------------------------------------------------------------
    # 12 cells per colour.  Cells 3,4,5 are byte-identical to 0,1,2 (the
    # ripper laid the same three flap frames down at a different vertical
    # offset), so only 0..2 and 6..11 are kept: 3 flap frames + 6 bank angles.
    for band, name in ALIEN_BANDS:
        for out_i, src_i in enumerate([0, 1, 2]):
            sprites[f'{name}_flap{out_i}'] = cell(px, band, src_i)
        for out_i, src_i in enumerate([6, 7, 8, 9, 10, 11]):
            sprites[f'{name}_bank{out_i}'] = cell(px, band, src_i)

    # --- flagship ----------------------------------------------------------
    # 7 cells: index 0 is the head-on formation pose, 1..6 bank away.
    sprites['boss_flap0'] = cell(px, BOSS_BAND, 0)
    for out_i, src_i in enumerate([1, 2, 3, 4, 5, 6]):
        sprites[f'boss_bank{out_i}'] = cell(px, BOSS_BAND, src_i)

    # --- player ship, stage flags, explosions, score labels ----------------
    for name, x, w in MISC_CELLS:
        sprites[name] = trim(grab(px, x, MISC_BAND, w, CELL))

    # --- player-death explosion, 32x32 -------------------------------------
    for i, x in enumerate([1, 34, 67, 100]):
        sprites[f'bigboom{i}'] = trim(grab(px, x, BIGBOOM_BAND, 32, 32))

    # --- shots -------------------------------------------------------------
    sprites['pshot'] = trim(grab(px, *PSHOT))
    sprites['eshot'] = trim(grab(px, *ESHOT))

    # --- font --------------------------------------------------------------
    font = {}
    idx = 0
    for band, count in FONT_BANDS:
        for i in range(count):
            ch = FONT_CHARS[idx]
            idx += 1
            # keep the full 8x8 box: glyph cells must stay on a fixed grid
            font[ch] = grab(px, X0 + FONT_PITCH * i, band, FONT_W, FONT_W)
    assert idx == len(FONT_CHARS), f'font count {idx} != {len(FONT_CHARS)}'

    out = {
        'palette': {k: '#%02X%02X%02X' % v for k, v in PAL.items()},
        'sprites': sprites,
        'font': font,
    }
    path = os.path.join(REF, 'assets.json')
    with open(path, 'w') as fh:
        json.dump(out, fh, indent=1, sort_keys=True)

    print(f'wrote {path}')
    print(f'  {len(sprites)} sprites, {len(font)} glyphs, {len(PAL)} colours')
    for name in ('red_flap0', 'red_bank5', 'boss_flap0', 'ship', 'ship_death',
                 'flag1', 'flag10', 'pshot', 'eshot', 'boom0', 'bigboom0',
                 'score800'):
        s = sprites[name]
        print(f'  {name:14s} {len(s[0])}x{len(s)}')


if __name__ == '__main__':
    main()
