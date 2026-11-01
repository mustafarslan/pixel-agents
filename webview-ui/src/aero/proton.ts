/**
 * Proton, the owner's cat: a British Shorthair, female, blue point. Her look (in-page 16x16 grids, no PNG: a pet folder would show in
 * the editor's pet tool) and her day (where she goes, how long she stays, what she does there).
 *
 * This file is pure: the office hands her a `ProtonWorld` (the tiles she may use, her own blocked set, the spots free right now) and
 * she decides. She is never counted as occupying a tile, so no route or station is ever blocked by her.
 */
import {
  PET_WALK_FRAME_DURATION_SEC,
  PET_WALK_SEQUENCE,
  PET_WALK_SPEED_PX_PER_SEC,
} from '../constants.js';
import { findPath } from '../office/layout/tileMap.js';
import { type AeroSpriteGrid, gridToSprite } from '../office/sprites/aeroFurniture.js';
import type { SpriteData, TileType as TileTypeVal } from '../office/types.js';
import { Direction, TILE_SIZE } from '../office/types.js';
import type { Tile } from './lounge.js';

// ── Her look ───────────────────────────────────────────────────────

/** Cream body and shadow, blue-grey points and their dark tip, sapphire eyes, a pink nose and the outline. */
/* eslint-disable pixel-agents/no-inline-colors -- sprite data: the palette of her grids, as the sprites' own files */
export const PROTON_PALETTE: Readonly<Record<string, string>> = {
  c: '#f5efe2',
  d: '#dfd6c5',
  b: '#6b7a8f',
  k: '#4e5b6e',
  e: '#4fa3e3',
  n: '#d98695',
  o: '#3f3740',
};
/* eslint-enable pixel-agents/no-inline-colors */

export type ProtonMode = 'walk' | 'sit' | 'sleep' | 'groom' | 'stretch' | 'knead';
type Frames = readonly [readonly string[], readonly string[], readonly string[]];

/**
 * Three frames of each: walking down, up and right (left is the right one flipped, once, at load), and a loop each for sitting
 * (tail flick, blink), sleeping (a curled loaf, breathing), grooming (a paw to the cheek), stretching and kneading.
 */
export const PROTON_GRIDS = {
  walkDown: [
    [
      '....oo.....oo...',
      '...obbooooobbo..',
      '...obbcccccbbo..',
      '....obcccccbo...',
      '...occccbcccco..',
      '...occebbbecco..',
      '...occbbnbbcco..',
      '....occbbbccoo..',
      '....occcccccoko.',
      '...occcccccccbo.',
      '...occcccccccbo.',
      '...occccccccco..',
      '....obbccbbco...',
      '....obbddbbdo...',
      '.....ooooooo....',
      '................',
    ],
    [
      '....oo.....oo...',
      '...obbooooobbo..',
      '...obbcccccbbo..',
      '....obcccccbo...',
      '...occccbcccco..',
      '...occebbbecco..',
      '...occbbnbbcco..',
      '....occbbbcco...',
      '....occccccco.o.',
      '...occcccccccoko',
      '...occcccccccobo',
      '...ocbbccccccbo.',
      '....obbccbbcoo..',
      '....oddddbbdo...',
      '.....ooooooo....',
      '................',
    ],
    [
      '....oo.....oo...',
      '...obbooooobbo..',
      '...obbcccccbbo..',
      '....obcccccbo...',
      '...occccbcccco..',
      '...occebbbecco..',
      '...occbbnbbcco..',
      '....occbbbcco.o.',
      '....occcccccooko',
      '...occcccccccobo',
      '...occcccccccbo.',
      '...occcccbbcco..',
      '....obbccbbco...',
      '....obbdddddo...',
      '.....ooooooo....',
      '................',
    ],
  ],
  walkUp: [
    [
      '....oo.....oo...',
      '...obbooooobbo..',
      '...obbcccccbbo..',
      '....obcccccbo...',
      '...occdddddcco..',
      '...occccccccco..',
      '...occccccccco..',
      '....occckccco...',
      '....occcbccco...',
      '...occccbcccco..',
      '...occccccccco..',
      '...occccccccco..',
      '....obbccbbco...',
      '....obbddbbdo...',
      '.....ooooooo....',
      '................',
    ],
    [
      '....oo.....oo...',
      '...obbooooobbo..',
      '...obbcccccbbo..',
      '....obcccccbo...',
      '...occdddddcco..',
      '...occccccccco..',
      '...occccccccco..',
      '....occcckcco...',
      '....occccbcco...',
      '...occccbcccco..',
      '...occccccccco..',
      '...ocbbcccccco..',
      '....obbccbbco...',
      '....oddddbbdo...',
      '.....ooooooo....',
      '................',
    ],
    [
      '....oo.....oo...',
      '...obbooooobbo..',
      '...obbcccccbbo..',
      '....obcccccbo...',
      '...occdddddcco..',
      '...occccccccco..',
      '...occccccccco..',
      '....occkcccco...',
      '....occbcccco...',
      '...occccbcccco..',
      '...occccccccco..',
      '...occcccbbcco..',
      '....obbccbbco...',
      '....obbdddddo...',
      '.....ooooooo....',
      '................',
    ],
  ],
  walkRight: [
    [
      '................',
      '.........o...o..',
      '........obooobo.',
      '........obbccobo',
      '..o.....occcccco',
      '.oko...ooccceeco',
      'obboooococcccbno',
      'oboocccccccccbbo',
      'obocccccccccccco',
      '.occcccccccccoo.',
      '..occccccccco...',
      '..oddddddddo....',
      '..obboocobbo....',
      '..obbo.oobbo....',
      '...oo....oo.....',
      '................',
    ],
    [
      '................',
      '.........o...o..',
      '........obooobo.',
      '........obbccobo',
      '........occcccco',
      '.o.....ooccceeco',
      'oko.ooococcccbno',
      'bo.occcccccccbbo',
      'boocccccccccccco',
      'obcccccccccccoo.',
      '.ooccccccccco...',
      '..oddddddddo....',
      '.obbooocoobbo...',
      '.obbo..o.obbo...',
      '..oo......oo....',
      '................',
    ],
    [
      '................',
      '.........o...o..',
      '........obooobo.',
      '..o.....obbccobo',
      '.oko....occcccco',
      'obbo...ooccceeco',
      'obo.ooococcccbno',
      'oboocccccccccbbo',
      '.oocccccccccccco',
      '.occcccccccccoo.',
      '..occccccccco...',
      '..oddddddddo....',
      '...obbocbbo.....',
      '...obboobbo.....',
      '....oo..oo......',
      '................',
    ],
  ],
  sit: [
    [
      '....oo.....oo...',
      '...obbooooobbo..',
      '...obbcccccbbo..',
      '....obcccccbo...',
      '...occccbcccco..',
      '...occebbbecco..',
      '...occbbnbbcco..',
      '....occbbbccoo..',
      '....occcccccoko.',
      '...occcccccccbo.',
      '...occcccccccbo.',
      '...occccccccco..',
      '....obbccbbco...',
      '....obbddbbdo...',
      '.....ooooooo....',
      '................',
    ],
    [
      '....oo.....oo...',
      '...obbooooobbo..',
      '...obbcccccbbo..',
      '....obcccccbo...',
      '...occccbcccco..',
      '...occebbbecco..',
      '...occbbnbbcco..',
      '....occbbbcco...',
      '....occccccco.o.',
      '...occcccccccoko',
      '...occcccccccobo',
      '...occcccccccbo.',
      '....obbccbbcoo..',
      '....obbddbbdo...',
      '.....ooooooo....',
      '................',
    ],
    [
      '....oo.....oo...',
      '...obbooooobbo..',
      '...obbcccccbbo..',
      '....obcccccbo...',
      '...occccbcccco..',
      '...occkbbbkcco..',
      '...occbbnbbcco..',
      '....occbbbccoo..',
      '....occcccccoko.',
      '...occcccccccbo.',
      '...occcccccccbo.',
      '...occccccccco..',
      '....obbccbbco...',
      '....obbddbbdo...',
      '.....ooooooo....',
      '................',
    ],
  ],
  sleep: [
    [
      '................',
      '................',
      '................',
      '................',
      '................',
      '.........oo..oo.',
      '........obboobbo',
      '......oooboccobo',
      '....ooccccccccco',
      '...ocdddccckkcco',
      '..occcccccccbbno',
      '.occccccccccbbbo',
      '..obbbbbbkcccco.',
      '..odddddddddddo.',
      '...ooocccccooo..',
      '......ooooo.....',
    ],
    [
      '................',
      '................',
      '................',
      '................',
      '................',
      '.........oo..oo.',
      '......ooobboobbo',
      '.....occcboccobo',
      '....ooccccccccco',
      '...ocdddccckkcco',
      '..occcccccccbbno',
      '.occccccccccbbbo',
      '..obbbbbbkcccco.',
      '..odddddddddddo.',
      '...ooocccccooo..',
      '......ooooo.....',
    ],
    [
      '................',
      '................',
      '................',
      '................',
      '................',
      '.........oo..oo.',
      '........obboobbo',
      '......oooboccobo',
      '....ooccccccccco',
      '...ocdddccckkcco',
      '..occcccccccbbno',
      '.occccccccccbbbo',
      '..obbbbbbkcccco.',
      '..odddddddddddo.',
      '...ooocccccooo..',
      '......ooooo.....',
    ],
  ],
  groom: [
    [
      '....oo.....oo...',
      '...obbooooobbo..',
      '...obbcccccbbo..',
      '....obcccccbo...',
      '...occccbcccco..',
      '...occebbbecco..',
      '...occbbnbbcco..',
      '....occbbbccoo..',
      '....occcccccoko.',
      '...occccccbccbo.',
      '...occccccbccbo.',
      '...occccccccco..',
      '....obbccccco...',
      '....obbdddddo...',
      '.....ooooooo....',
      '................',
    ],
    [
      '....oo.....oo...',
      '...obbooooobbo..',
      '...obbcccccbbo..',
      '....obcccccbo...',
      '...occccbcccco..',
      '...occebbbkcco..',
      '...occbbnbbcco..',
      '....occbbbccoo..',
      '....occcccbboko.',
      '...occccccbccbo.',
      '...occcccccccbo.',
      '...occccccccco..',
      '....obbccccco...',
      '....obbdddddo...',
      '.....ooooooo....',
      '................',
    ],
    [
      '....oo.....oo...',
      '...obbooooobbo..',
      '...obbcccccbbo..',
      '....obcccccbo...',
      '...occccbcccco..',
      '...occebbbecco..',
      '...occbbnbbcco..',
      '....occbbbccoo..',
      '....occcccccoko.',
      '...occccccbccbo.',
      '...occccccbccbo.',
      '...occccccccco..',
      '....obbccccco...',
      '....obbdddddo...',
      '.....ooooooo....',
      '................',
    ],
  ],
  stretch: [
    [
      '................',
      '................',
      '................',
      '..o.............',
      '.oko.oo.........',
      '.oboocco..o...o.',
      '.oboccccoobooobo',
      '..occccccobocobo',
      '..occcccccccccco',
      '..occcccccccekcc',
      '...occcccccccbnc',
      '...ooccccccccbbo',
      '..obboooccbccco.',
      '..obbo..oobbbbo.',
      '...oo.....oooo..',
      '................',
    ],
    [
      '................',
      '................',
      '..o.............',
      '.oko.oo.........',
      '.oboocco........',
      '.obocccco.o...o.',
      '..occccccobooobo',
      '..occccccobocobo',
      '..occcccccccccco',
      '...occccccccekcc',
      '....occccccccbnc',
      '...ooocccccccbbo',
      '..obboooccbccco.',
      '..obbo..oobbbbbo',
      '...oo.....ooooo.',
      '................',
    ],
    [
      '................',
      '................',
      '................',
      '..o.............',
      '.oko.oo.........',
      '.oboocco..o...o.',
      '.oboccccoobooobo',
      '..occccccobocobo',
      '..occcccccccccco',
      '..occcccccccekcc',
      '...occcccccccbnc',
      '...ooccccccccbbo',
      '..obboooccbcccbo',
      '..obbo..oobbbbbo',
      '...oo.....ooooo.',
      '................',
    ],
  ],
  knead: [
    [
      '................',
      '....oo.....oo...',
      '...obbo...obbo..',
      '...obbcooocbbo..',
      '....obcccccbo...',
      '....occcbccco...',
      '...occkbbbkcco..',
      '...occbbnbbcco..',
      '....occbbbcco...',
      '....occccccco...',
      '...occccccccco..',
      '..occccccccbbco.',
      '...obbcccccbbbko',
      '...obbdddddddoo.',
      '....ooooooooo...',
      '................',
    ],
    [
      '................',
      '....oo.....oo...',
      '...obbo...obbo..',
      '...obbcooocbbo..',
      '....obcccccbo...',
      '....occcbccco...',
      '...occkbbbkcco..',
      '...occbbnbbcco..',
      '....occbbbcco...',
      '....occccccco...',
      '...occccccccco..',
      '..ocbbcccccccco.',
      '...obbcccccbbbko',
      '...odddddddbboo.',
      '....ooooooooo...',
      '................',
    ],
    [
      '................',
      '....oo.....oo...',
      '...obbo...obbo..',
      '...obbcooocbbo..',
      '....obcccccbo...',
      '....occcbccco...',
      '...occkbbbkcco..',
      '...occbbnbbcco..',
      '....occbbbcco...',
      '....occccccco...',
      '...occccccccco..',
      '..occccccccccco.',
      '...obbcccccbbbko',
      '...obbdddddbboo.',
      '....ooooooooo...',
      '................',
    ],
  ],
} satisfies Record<string, Frames>;

const decode = (frames: Frames): SpriteData[] =>
  frames.map((map) => gridToSprite({ map, palette: PROTON_PALETTE } satisfies AeroSpriteGrid));
const flipX = (sprite: SpriteData): SpriteData => sprite.map((row) => [...row].reverse());

const WALK_RIGHT = decode(PROTON_GRIDS.walkRight);

/** Every frame, decoded once at load: the sprite cache keys on the array object, so these are never rebuilt. */
export const PROTON_SPRITES = {
  walk: {
    [Direction.DOWN]: decode(PROTON_GRIDS.walkDown),
    [Direction.UP]: decode(PROTON_GRIDS.walkUp),
    [Direction.RIGHT]: WALK_RIGHT,
    [Direction.LEFT]: WALK_RIGHT.map(flipX),
  },
  sit: decode(PROTON_GRIDS.sit),
  sleep: decode(PROTON_GRIDS.sleep),
  groom: decode(PROTON_GRIDS.groom),
  stretch: decode(PROTON_GRIDS.stretch),
  knead: decode(PROTON_GRIDS.knead),
} as const;

/** Seconds a frame of an action loop shows. */
const LOOP_FRAME_SEC = 0.35;
/** The blinking sit loop: mostly the open eyes, the tail flick, a blink. */
const SIT_SEQUENCE = [0, 0, 0, 1, 0, 0, 2, 0] as const;

/** The sprite for `mode` facing `dir` after `t` seconds of the same mode. Sitting facing up shows her from behind. */
export function protonSpriteOf(mode: ProtonMode, dir: Direction, t: number): SpriteData {
  if (mode === 'walk') {
    const frames = PROTON_SPRITES.walk[dir];
    const i = Math.floor(t / PET_WALK_FRAME_DURATION_SEC) % PET_WALK_SEQUENCE.length;
    return frames[PET_WALK_SEQUENCE[i]];
  }
  if (mode === 'sit') {
    if (dir === Direction.UP) return PROTON_SPRITES.walk[Direction.UP][0];
    return PROTON_SPRITES.sit[SIT_SEQUENCE[Math.floor(t / LOOP_FRAME_SEC) % SIT_SEQUENCE.length]];
  }
  const frames = PROTON_SPRITES[mode];
  return frames[Math.floor(t / LOOP_FRAME_SEC) % frames.length];
}

// ── Where she goes ─────────────────────────────────────────────────

export type SpotKind = 'agent' | 'sofa' | 'sun' | 'desk' | 'cafe';
export const SPOT_KINDS: readonly SpotKind[] = ['agent', 'sofa', 'sun', 'desk', 'cafe'];

/** Her first wait, before she moves for the first time, and the longest she stays anywhere. */
export const PROTON_FIRST_WAIT_SEC = 3;
const STAY_MIN_SEC = 10;
const STAY_MAX_SEC = 20;
const STAY_CAP: Record<SpotKind, number> = { agent: 15, sofa: 20, sun: 20, desk: 12, cafe: 10 };
const KNEAD_SEC = 4;
const STRETCH_SEC = 3;
const WANDER_MIN_SEC = 3;
const WANDER_MAX_SEC = 6;
const RETRY_SEC = 2;
const PICK_TRIES = 4;

/** How often each kind of spot is chosen: next to a working agent, a sofa, a sun spot, under a desk, begging by the café. */
export function spotWeights(lunch: boolean): Record<SpotKind, number> {
  return { agent: 30, sofa: 25, sun: 15, desk: 15, cafe: lunch ? 35 : 15 };
}

/** A kind by weight among those that have a spot now; null when none does. */
export function pickKind(
  rng: () => number,
  available: ReadonlySet<SpotKind>,
  lunch: boolean,
): SpotKind | null {
  const weights = spotWeights(lunch);
  const kinds = SPOT_KINDS.filter((k) => available.has(k));
  const total = kinds.reduce((a, k) => a + weights[k], 0);
  if (kinds.length === 0 || total <= 0) return null;
  let r = rng() * total;
  for (const k of kinds) {
    r -= weights[k];
    if (r < 0) return k;
  }
  return kinds[kinds.length - 1];
}

/** How long she stays at a spot: 10 to 20 seconds, capped by what she does there. */
export function stayFor(kind: SpotKind, rng: () => number): number {
  return Math.min(STAY_CAP[kind], STAY_MIN_SEC + rng() * (STAY_MAX_SEC - STAY_MIN_SEC));
}

export interface Phase {
  mode: ProtonMode;
  secs: number;
}

/** What she does during a stay of `stay` seconds, in order. */
export function planFor(kind: SpotKind, stay: number): Phase[] {
  switch (kind) {
    case 'sofa':
      return [
        { mode: 'knead', secs: KNEAD_SEC },
        { mode: 'sleep', secs: stay - KNEAD_SEC },
      ];
    case 'sun':
      return [
        { mode: 'stretch', secs: STRETCH_SEC },
        { mode: 'sleep', secs: stay - STRETCH_SEC },
      ];
    case 'cafe':
      return [{ mode: 'sit', secs: stay }];
    case 'agent':
      return [
        { mode: 'sit', secs: stay * 0.6 },
        { mode: 'groom', secs: stay * 0.4 },
      ];
    case 'desk':
      return [
        { mode: 'sit', secs: stay / 2 },
        { mode: 'groom', secs: stay / 2 },
      ];
  }
}

// ── The tiles she may use ──────────────────────────────────────────

const key = (col: number, row: number): string => `${col},${row}`;
const TOILETS = 'Toilets';

export interface ProtonAreaInput {
  cols: number;
  rows: number;
  /** Per-tile area labels, row-major (`cols` wide). */
  areaTiles: ReadonlyArray<string | null> | undefined;
  /** The layout's blocked tiles (chairs and furniture). */
  blocked: ReadonlySet<string>;
  /** The tiles in front of the lifts. */
  lobby: readonly Tile[];
  /** The turnstile pieces: the rows below their top row, across the columns they span, are the throat to the lobby. */
  turnstiles: ReadonlyArray<{ col: number; row: number; w: number; h: number }>;
  /** The seats of sofas seen from the front or the side. */
  sofaSeats: readonly Tile[];
  /** The Lounge's seats (unlabelled). */
  loungeSeats: readonly Tile[];
}

export interface ProtonArea {
  /** The tiles she walks on: labelled, unblocked, not the toilets, the lobby or the turnstile throat, in the largest connected part. */
  walk: Set<string>;
  /** Seats she may sit on: sofa and Lounge seats beside the walk area. They are blocked tiles, unblocked only as a target. */
  seats: Set<string>;
  /** Her own blocked set: the layout's blocked tiles, and every tile that is not in `walk`. */
  blocked: Set<string>;
}

export function protonArea(input: ProtonAreaInput): ProtonArea {
  const { cols, rows, areaTiles, blocked } = input;
  const lobby = new Set(input.lobby.map((t) => key(t.col, t.row)));
  // The throat: every row below the turnstiles' top row, across the columns they span (the gap between them included).
  const gates = input.turnstiles;
  const gateLeft = Math.min(...gates.map((t) => t.col));
  const gateRight = Math.max(...gates.map((t) => t.col + t.w - 1));
  const gateTop = Math.min(...gates.map((t) => t.row));
  const throat = (col: number, row: number): boolean =>
    gates.length > 0 && col >= gateLeft && col <= gateRight && row > gateTop;
  const labelAt = (col: number, row: number): string | null =>
    areaTiles?.[row * cols + col] ?? null;
  const excluded = (col: number, row: number): boolean =>
    lobby.has(key(col, row)) || throat(col, row);

  const open = new Set<string>();
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const label = labelAt(col, row);
      if (label === null || label === '' || label === TOILETS) continue;
      if (blocked.has(key(col, row)) || excluded(col, row)) continue;
      open.add(key(col, row));
    }
  }
  // The largest 4-connected part, the first in row order on a tie.
  const seen = new Set<string>();
  let walk = new Set<string>();
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const start = key(col, row);
      if (!open.has(start) || seen.has(start)) continue;
      const part = new Set<string>([start]);
      seen.add(start);
      const stack: Array<[number, number]> = [[col, row]];
      while (stack.length > 0) {
        const [c, r] = stack.pop()!;
        for (const [dc, dr] of [
          [0, -1],
          [0, 1],
          [-1, 0],
          [1, 0],
        ] as const) {
          const k = key(c + dc, r + dr);
          if (!open.has(k) || seen.has(k)) continue;
          seen.add(k);
          part.add(k);
          stack.push([c + dc, r + dr]);
        }
      }
      if (part.size > walk.size) walk = part;
    }
  }
  const seats = new Set<string>();
  for (const t of [...input.sofaSeats, ...input.loungeSeats]) {
    if (labelAt(t.col, t.row) === TOILETS || excluded(t.col, t.row)) continue;
    const beside = [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ].some(([dc, dr]) => walk.has(key(t.col + dc, t.row + dr)));
    if (beside) seats.add(key(t.col, t.row));
  }
  const own = new Set(blocked);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (!walk.has(key(col, row))) own.add(key(col, row));
    }
  }
  return { walk, seats, blocked: own };
}

/** A pod's origin: the top-left of the tiles labelled `Pod N`. Under-desk spots are two and four columns in, two rows down. */
export function podOrigins(
  areaTiles: ReadonlyArray<string | null> | undefined,
  cols: number,
  rows: number,
): Tile[] {
  const boxes = new Map<string, Tile>();
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const label = areaTiles?.[row * cols + col];
      if (typeof label !== 'string' || !/^Pod \d+$/.test(label)) continue;
      const box = boxes.get(label);
      if (!box) boxes.set(label, { col, row });
      else boxes.set(label, { col: Math.min(box.col, col), row: Math.min(box.row, row) });
    }
  }
  return [...boxes.values()];
}

/** The fixed spots: the café's fridge, coffee machine and buffet fronts, and the head of the atrium in the sun. */
export const CAFE_SPOTS: readonly Tile[] = [
  { col: 8, row: 21 },
  { col: 10, row: 21 },
  { col: 8, row: 24 },
  { col: 9, row: 24 },
];
export const ATRIUM_HEAD: readonly Tile[] = [25, 26, 27, 28].map((col) => ({ col, row: 2 }));

// ── Her day ────────────────────────────────────────────────────────

export interface ProtonSpot extends Tile {
  /** The nap seat's uid, for a sofa. */
  seat?: string;
}

/** What the office tells her each time she decides. */
export interface ProtonWorld {
  rng: () => number;
  lunch: boolean;
  /** Her own blocked set (see `ProtonArea.blocked`); the search unblocks only the target seat and puts it back. */
  blocked: Set<string>;
  tileMap: TileTypeVal[][];
  /** The tiles she walks on, for a wander. */
  walk: ReadonlySet<string>;
  /** The spots of a kind that are free now. */
  spots(kind: SpotKind): ProtonSpot[];
}

export class Proton {
  col: number;
  row: number;
  /** Pixel position, the tile's centre while she stands (the bottom-centre anchor, as the pets'). */
  x: number;
  y: number;
  dir: Direction = Direction.DOWN;
  mode: ProtonMode = 'sit';
  /** Tiles stepped, ever. */
  moves = 0;
  /** The nap seat she walks to or sits on, or null. */
  seat: string | null = null;
  spot: SpotKind | null = null;
  /** Seconds in the current mode (the animation clock). */
  clock = 0;
  private path: Tile[] = [];
  private progress = 0;
  private timer = PROTON_FIRST_WAIT_SEC;
  private phases: Phase[] = [];

  constructor(tile: Tile) {
    this.col = tile.col;
    this.row = tile.row;
    this.x = tile.col * TILE_SIZE + TILE_SIZE / 2;
    this.y = tile.row * TILE_SIZE + TILE_SIZE / 2;
  }

  /** Puts her on a tile, standing, and gives up whatever she was doing. */
  place(tile: Tile): void {
    this.col = tile.col;
    this.row = tile.row;
    this.giveUp();
  }

  /** Stops where she is (her last whole tile) and decides again on the next step; she holds no seat. */
  giveUp(): void {
    this.seat = null;
    this.spot = null;
    this.path = [];
    this.progress = 0;
    this.phases = [];
    this.timer = 0;
    this.x = this.col * TILE_SIZE + TILE_SIZE / 2;
    this.y = this.row * TILE_SIZE + TILE_SIZE / 2;
    this.setMode('sit');
  }

  private setMode(mode: ProtonMode): void {
    if (this.mode !== mode) this.clock = 0;
    this.mode = mode;
  }

  update(dt: number, w: ProtonWorld): void {
    this.clock += dt;
    if (this.path.length > 0) {
      this.walk(dt, w);
      return;
    }
    this.timer -= dt;
    if (this.timer > 0) return;
    const next = this.phases.shift();
    if (next) {
      this.timer = next.secs;
      this.setMode(next.mode);
      return;
    }
    this.pick(w);
  }

  private walk(dt: number, w: ProtonWorld): void {
    this.progress += (PET_WALK_SPEED_PX_PER_SEC * dt) / TILE_SIZE;
    while (this.progress >= 1 && this.path.length > 0) {
      const next = this.path.shift()!;
      this.progress -= 1;
      this.col = next.col;
      this.row = next.row;
      this.moves++;
      if (this.path.length > 0) this.face(this.path[0]);
    }
    if (this.path.length === 0) {
      this.progress = 0;
      this.x = this.col * TILE_SIZE + TILE_SIZE / 2;
      this.y = this.row * TILE_SIZE + TILE_SIZE / 2;
      this.arrive(w);
      return;
    }
    const next = this.path[0];
    this.x = (this.col + (next.col - this.col) * this.progress) * TILE_SIZE + TILE_SIZE / 2;
    this.y = (this.row + (next.row - this.row) * this.progress) * TILE_SIZE + TILE_SIZE / 2;
  }

  private face(to: Tile): void {
    if (to.col > this.col) this.dir = Direction.RIGHT;
    else if (to.col < this.col) this.dir = Direction.LEFT;
    else if (to.row > this.row) this.dir = Direction.DOWN;
    else this.dir = Direction.UP;
  }

  /** At the spot: starts the stay (a nap from the front, the café facing up). */
  private arrive(w: ProtonWorld): void {
    const kind = this.spot;
    this.dir = kind === 'cafe' ? Direction.UP : Direction.DOWN;
    if (kind === null) {
      this.phases = [];
      this.timer = WANDER_MIN_SEC + w.rng() * (WANDER_MAX_SEC - WANDER_MIN_SEC);
      this.setMode('sit');
      return;
    }
    this.phases = planFor(kind, stayFor(kind, w.rng));
    const first = this.phases.shift()!;
    this.timer = first.secs;
    this.setMode(first.mode);
  }

  /** Chooses the next spot and starts walking; a wander or a wait when nothing can be reached. */
  private pick(w: ProtonWorld): void {
    const here = key(this.col, this.row);
    for (let attempt = 0; attempt < PICK_TRIES; attempt++) {
      const available = new Set<SpotKind>();
      const book = new Map<SpotKind, ProtonSpot[]>();
      for (const kind of SPOT_KINDS) {
        const list = w.spots(kind).filter((s) => key(s.col, s.row) !== here);
        if (list.length > 0) {
          available.add(kind);
          book.set(kind, list);
        }
      }
      const kind = pickKind(w.rng, available, w.lunch);
      if (kind === null) break;
      const list = book.get(kind)!;
      const spot = list[Math.floor(w.rng() * list.length) % list.length];
      if (this.go(spot, kind, w)) return;
    }
    // Nothing reachable: a short turn about the area, or a wait.
    const tiles = [...w.walk].filter((k) => k !== here);
    if (tiles.length > 0) {
      const [c, r] = tiles[Math.floor(w.rng() * tiles.length) % tiles.length]
        .split(',')
        .map(Number);
      if (this.go({ col: c, row: r }, null, w)) return;
    }
    this.timer = RETRY_SEC;
    this.setMode('sit');
  }

  private go(spot: ProtonSpot, kind: SpotKind | null, w: ProtonWorld): boolean {
    const k = key(spot.col, spot.row);
    const wasBlocked = w.blocked.delete(k);
    const path = findPath(this.col, this.row, spot.col, spot.row, w.tileMap, w.blocked);
    if (wasBlocked) w.blocked.add(k);
    if (path.length === 0) return false;
    this.path = path;
    this.progress = 0;
    this.spot = kind;
    this.seat = spot.seat ?? null;
    this.face(path[0]);
    this.setMode('walk');
    return true;
  }
}
