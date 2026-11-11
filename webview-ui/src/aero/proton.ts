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
export const PROTON_PALETTE: Readonly<Record<string, string>> = {
  c: '#f5efe2',
  d: '#dfd6c5',
  b: '#6b7a8f',
  k: '#4e5b6e',
  e: '#4fa3e3',
  n: '#d98695',
  o: '#3f3740',
};

export type ProtonMode =
  | 'walk'
  | 'sit'
  | 'sleep'
  | 'groom'
  | 'stretch'
  | 'knead'
  | 'eat'
  | 'drink'
  | 'bat'
  | 'pounce'
  | 'chase'
  | 'scratch';
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

/**
 * Her head down at a bowl, seen from the side facing right (left is this flipped, once, at load). Eating and drinking show it; a bat
 * at the ball and scratching the litter show her kneading, a pounce her stretching, and a chase of the ball her walk.
 */
export const PROTON_EAT_GRID = [
  [
    '................',
    '................',
    '................',
    '................',
    '..o......o...o..',
    '.oko...oobooobo.',
    'obbooooccbbccobo',
    'obooccccccccccco',
    'oboccccccccceeco',
    '.occcccccccccbno',
    '..occcccccccobbo',
    '..oddddddddoccco',
    '..obboocobbocoo.',
    '..obbo.oobbo....',
    '...oo....oo.....',
    '................',
  ],
  [
    '................',
    '................',
    '................',
    '................',
    '................',
    '.o.....o.o...o..',
    'oko.oooccbooobo.',
    'bo.occcccbbccobo',
    'boocccccccccccco',
    'obcccccccccceeco',
    '.oocccccccccobno',
    '..oddddddddocbbo',
    '.obbooocoobbocco',
    '.obbo..ocobbooo.',
    '..oo......oo....',
    '................',
  ],
  [
    '................',
    '................',
    '................',
    '..o.............',
    '.oko.....o...o..',
    'obbo...oobooobo.',
    'obo.oooccbbccobo',
    'obooccccccccccco',
    '.ooccccccccceeco',
    '.occcccccccccbno',
    '..occcccccccobbo',
    '..oddddddddoccco',
    '...obbocbboccoo.',
    '...obboobbo.....',
    '....oo..oo......',
    '................',
  ],
] satisfies Frames;

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
  eat: { right: decode(PROTON_EAT_GRID), left: decode(PROTON_EAT_GRID).map(flipX) },
} as const;

/** Seconds a frame of an action loop shows. */
const LOOP_FRAME_SEC = 0.35;
/** The blinking sit loop: mostly the open eyes, the tail flick, a blink. */
const SIT_SEQUENCE = [0, 0, 0, 1, 0, 0, 2, 0] as const;

/** The sprite for `mode` facing `dir` after `t` seconds of the same mode. Sitting facing up shows her from behind. */
export function protonSpriteOf(mode: ProtonMode, dir: Direction, t: number): SpriteData {
  if (mode === 'eat' || mode === 'drink') {
    const frames = dir === Direction.LEFT ? PROTON_SPRITES.eat.left : PROTON_SPRITES.eat.right;
    return frames[Math.floor(t / LOOP_FRAME_SEC) % frames.length];
  }
  if (mode === 'bat' || mode === 'scratch') mode = 'knead';
  else if (mode === 'pounce') mode = 'stretch';
  else if (mode === 'chase') mode = 'walk';
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

export type SpotKind =
  'agent' | 'sofa' | 'sun' | 'desk' | 'cafe' | 'ball' | 'eat' | 'drink' | 'litter';
export const SPOT_KINDS: readonly SpotKind[] = [
  'agent',
  'sofa',
  'sun',
  'desk',
  'cafe',
  'ball',
  'eat',
  'drink',
  'litter',
];

/** Her first wait, before she moves for the first time, and the longest she stays anywhere. */
export const PROTON_FIRST_WAIT_SEC = 3;
const STAY_MIN_SEC = 10;
const STAY_MAX_SEC = 20;
const STAY_CAP: Record<SpotKind, number> = {
  agent: 15,
  sofa: 20,
  sun: 20,
  desk: 12,
  cafe: 10,
  ball: 18,
  eat: 12,
  drink: 10,
  litter: 12,
};
const KNEAD_SEC = 4;
const STRETCH_SEC = 3;
const WANDER_MIN_SEC = 3;
const WANDER_MAX_SEC = 6;
const RETRY_SEC = 2;
const PICK_TRIES = 4;

/**
 * How often each kind of spot is chosen (about 22 s a cycle): next to a working agent, a sofa, a sun spot, under a desk, begging by the
 * café, the ball, the food and water bowls (more at lunch) and the litter box.
 */
export function spotWeights(lunch: boolean): Record<SpotKind, number> {
  return {
    agent: 23,
    sofa: 18,
    sun: 12,
    desk: 11,
    cafe: lunch ? 24 : 10,
    ball: 9,
    eat: lunch ? 15 : 7,
    drink: lunch ? 13 : 7,
    litter: 3,
  };
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
  /** After a bat she bats the ball on and chases it when the phase ends. */
  after?: 'chase';
}

/** Her first look at the ball, a bat, and a pounce, in seconds. */
const BALL_WATCH_SEC = 1.5;
const BALL_BAT_SEC = 0.8;
const BALL_POUNCE_SEC = 1;
/** The litter box's last seconds: scratching. */
const SCRATCH_SEC = 4;

/** What she does during a stay of `stay` seconds, in order; `bats` is how many times she bats the ball (1 or 2). */
export function planFor(kind: SpotKind, stay: number, bats = 1): Phase[] {
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
    case 'eat':
      return [{ mode: 'eat', secs: stay }];
    case 'drink':
      return [{ mode: 'drink', secs: stay }];
    case 'litter':
      return [
        { mode: 'sit', secs: stay - SCRATCH_SEC },
        { mode: 'scratch', secs: SCRATCH_SEC },
      ];
    case 'ball': {
      const plan: Phase[] = [{ mode: 'sit', secs: BALL_WATCH_SEC }];
      for (let i = 0; i < bats; i++) {
        plan.push({ mode: 'bat', secs: BALL_BAT_SEC, after: 'chase' });
        plan.push({ mode: 'pounce', secs: BALL_POUNCE_SEC });
      }
      const rest = stay - plan.reduce((a, p) => a + p.secs, 0);
      plan.push({ mode: 'sit', secs: Math.max(rest, 0.1) });
      return plan;
    }
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
  /** The litter box: blocked for people, a target for her like a seat. */
  boxes?: readonly Tile[];
}

export interface ProtonArea {
  /** The tiles she walks on: labelled, unblocked, not the toilets, the lobby or the turnstile throat, in the largest connected part. */
  walk: Set<string>;
  /** Seats she may sit on: sofa and Lounge seats, and the litter box, beside the walk area. They are blocked tiles, unblocked only as a target. */
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
  for (const t of [...input.sofaSeats, ...input.loungeSeats, ...(input.boxes ?? [])]) {
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

// ── Her care corner ────────────────────────────────────────────────

/**
 * Where her things are in the open office (read from its layout, 54 by 36). The food bowl stands in the café's west column, left of the
 * fridge's spot (8,21), and she eats from (8,21) facing left: the terrace's railings and plants already hold (6,21) and (6,22), the tiles
 * agy first named. The water bowl is in the dead-end pocket (7,25) at the column's foot and she drinks from (8,25), a tile clear of the
 * buffet counter (8..9, 22..23: its back row would put her under the sneeze guard). The litter box is the terrace's north-west corner, the furthest unblocked tile from the café, the
 * pods, the toilets and the turnstile throat. The ball starts in the atrium, below the head of it.
 */
export const CARE = {
  food: { col: 7, row: 21 },
  water: { col: 7, row: 25 },
  foodFrom: { col: 8, row: 21 },
  waterFrom: { col: 8, row: 25 },
  litter: { col: 2, row: 19 },
  ball: { col: 26, row: 4 },
} as const satisfies Record<string, Tile>;

const CAFE = 'Café';
const TERRACE = 'Terrace';

export interface CareBowl {
  kind: 'eat' | 'drink';
  bowl: Tile;
  /** The tile she stands on at the bowl, and the way she faces. */
  from: Tile;
  face: Direction;
}

export interface CarePlan {
  bowls: CareBowl[];
  litter: Tile | null;
  ball: Tile | null;
}

export interface CarePlanInput {
  cols: number;
  rows: number;
  areaTiles: ReadonlyArray<string | null> | undefined;
  /** The layout's own blocked tiles, without the care set. */
  blocked: ReadonlySet<string>;
}

/** The ways she can stand to bat the ball at `ball`: from the tile behind it with a walk tile ahead of it to roll to. */
export function ballSpotDirs(walk: ReadonlySet<string>, ball: Tile): Direction[] {
  const out: Direction[] = [];
  for (const [dc, dr, face] of [
    [0, 1, Direction.DOWN],
    [0, -1, Direction.UP],
    [1, 0, Direction.RIGHT],
    [-1, 0, Direction.LEFT],
  ] as const) {
    if (
      walk.has(key(ball.col - dc, ball.row - dr)) &&
      walk.has(key(ball.col + dc, ball.row + dr))
    ) {
      out.push(face);
    }
  }
  return out;
}

const directionBetween = (from: Tile, to: Tile): Direction =>
  to.col > from.col
    ? Direction.RIGHT
    : to.col < from.col
      ? Direction.LEFT
      : to.row > from.row
        ? Direction.DOWN
        : Direction.UP;

/** The care set the layout has room for: a bowl needs its tile and hers free in the café, the box a free terrace tile, the ball a free labelled one. */
export function carePlan(input: CarePlanInput): CarePlan {
  const { cols, rows, areaTiles, blocked } = input;
  const labelAt = (t: Tile): string | null =>
    t.col < 0 || t.row < 0 || t.col >= cols || t.row >= rows
      ? null
      : (areaTiles?.[t.row * cols + t.col] ?? null);
  const free = (t: Tile, label: string): boolean =>
    labelAt(t) === label && !blocked.has(key(t.col, t.row));
  const bowls: CareBowl[] = [];
  for (const [kind, bowl, from] of [
    ['eat', CARE.food, CARE.foodFrom],
    ['drink', CARE.water, CARE.waterFrom],
  ] as const) {
    if (free(bowl, CAFE) && free(from, CAFE)) {
      bowls.push({ kind, bowl, from, face: directionBetween(from, bowl) });
    }
  }
  const ballLabel = labelAt(CARE.ball);
  return {
    bowls,
    litter: free(CARE.litter, TERRACE) ? CARE.litter : null,
    ball:
      ballLabel !== null &&
      ballLabel !== '' &&
      ballLabel !== TOILETS &&
      !blocked.has(key(CARE.ball.col, CARE.ball.row))
        ? CARE.ball
        : null,
  };
}

/** Her things' colours: the bowls' rims and food and water, the litter tray and sand, and the red, white and yellow ball. */
export const CARE_PALETTE: Readonly<Record<string, string>> = {
  o: '#3f3740',
  k: '#8a5a3c',
  d: '#6b4128',
  r: '#c8553d',
  w: '#9fd3f2',
  h: '#e6f6ff',
  b: '#5b8fb9',
  u: '#7d8a9c',
  t: '#9aa7b8',
  s: '#e6d5a8',
  p: '#cdb985',
  R: '#d9453d',
  W: '#f4f4f4',
  Y: '#f2c230',
};

/** The food bowl, the water bowl, the litter box and the ball: 16x16, drawn at the bottom of the tile like her. */
export const CARE_GRIDS = {
  food: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '....oooooooo....',
    '...okdkkdkkdo...',
    '..orrrrrrrrrro..',
    '...orrrrrrrro...',
    '....oooooooo....',
    '................',
  ],
  water: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '....oooooooo....',
    '...owhwwwwwwo...',
    '..obbbbbbbbbbo..',
    '...obbbbbbbbo...',
    '....oooooooo....',
    '................',
  ],
  litter: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '..oooooooooooo..',
    '..ouuuuuuuuuuo..',
    '..osspssspssso..',
    '..otttttttttto..',
    '..oooooooooooo..',
    '................',
  ],
  ball: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '.......ooo......',
    '......oRWRo.....',
    '.....oRRWYRo....',
    '.....oWWRYYo....',
    '......oRYRo.....',
    '.......ooo......',
    '................',
  ],
} satisfies Record<string, readonly string[]>;

/** Decoded once at load, so the sprite cache keeps them. */
export const CARE_SPRITES = {
  food: gridToSprite({ map: CARE_GRIDS.food, palette: CARE_PALETTE } satisfies AeroSpriteGrid),
  water: gridToSprite({ map: CARE_GRIDS.water, palette: CARE_PALETTE } satisfies AeroSpriteGrid),
  litter: gridToSprite({ map: CARE_GRIDS.litter, palette: CARE_PALETTE } satisfies AeroSpriteGrid),
  ball: gridToSprite({ map: CARE_GRIDS.ball, palette: CARE_PALETTE } satisfies AeroSpriteGrid),
} as const;

// ── Her day ────────────────────────────────────────────────────────

export interface ProtonSpot extends Tile {
  /** The nap seat's uid, for a sofa. */
  seat?: string;
  /** The way she faces on arriving: at a bowl, the bowl; by the ball, the ball. */
  face?: Direction;
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
  /** The ball's tile, or null when there is none, and the way to move it (to a tile of `walk`). */
  ball: Tile | null;
  setBall(tile: Tile): void;
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
  /** Pre-empted on the way: decide again on arriving at the tile she was stepping to. */
  private rushed = false;
  /** The phase running, the way she faces on arriving, the way the ball lies from her, and whether she is chasing it. */
  private cur: Phase | null = null;
  private arriveDir: Direction | null = null;
  private playDir: Direction | null = null;
  private chasing = false;

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
    this.giveUp(false);
  }

  /**
   * Lets go of whatever she was doing and decides again. Pre-empted between two tiles she finishes that one step first (`settle`,
   * the default) and decides on arrival; otherwise (a new layout) she stands on her last whole tile at once.
   */
  giveUp(settle = true): void {
    this.seat = null;
    this.spot = null;
    this.phases = [];
    this.timer = 0;
    this.cur = null;
    this.chasing = false;
    this.playDir = null;
    if (settle && this.path.length > 0 && this.progress > 0) {
      this.path = [this.path[0]];
      this.rushed = true;
      return;
    }
    this.path = [];
    this.progress = 0;
    this.rushed = false;
    this.x = this.col * TILE_SIZE + TILE_SIZE / 2;
    this.y = this.row * TILE_SIZE + TILE_SIZE / 2;
    this.setMode('sit');
  }

  /** The tile of the spot she walks to or stands at. */
  spotTile(): Tile {
    return this.path.length > 0
      ? this.path[this.path.length - 1]
      : { col: this.col, row: this.row };
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
    const done = this.cur;
    this.cur = null;
    if (done?.after === 'chase' && this.chase(w)) return;
    const next = this.phases.shift();
    if (next) {
      this.begin(next);
      return;
    }
    this.pick(w);
  }

  private begin(phase: Phase): void {
    this.timer = phase.secs;
    this.cur = phase;
    this.setMode(phase.mode);
  }

  /**
   * Bats the ball one or two tiles straight away from her (only over tiles she walks on) and goes after it, to stand beside it again. False
   * when the ball is not beside her or has no room to roll.
   */
  private chase(w: ProtonWorld): boolean {
    const d = this.playDir;
    const ball = w.ball;
    if (d === null || ball === null) return false;
    const dc = d === Direction.RIGHT ? 1 : d === Direction.LEFT ? -1 : 0;
    const dr = d === Direction.DOWN ? 1 : d === Direction.UP ? -1 : 0;
    if (ball.col !== this.col + dc || ball.row !== this.row + dr) return false;
    const want = 1 + Math.floor(w.rng() * 2);
    let n = 0;
    while (n < want && w.walk.has(key(ball.col + dc * (n + 1), ball.row + dr * (n + 1)))) n++;
    // It only lands where she can bat it again (a tile with a walk tile either side of it in a line): n tiles, else one fewer, else no bat.
    while (
      n > 0 &&
      ballSpotDirs(w.walk, { col: ball.col + dc * n, row: ball.row + dr * n }).length === 0
    ) {
      n--;
    }
    if (n === 0) return false;
    w.setBall({ col: ball.col + dc * n, row: ball.row + dr * n });
    this.path = Array.from({ length: n }, (_, i) => ({
      col: ball.col + dc * i,
      row: ball.row + dr * i,
    }));
    this.progress = 0;
    this.chasing = true;
    this.face(this.path[0]);
    this.setMode('chase');
    // The chase is part of the stay: what she walks is taken off the time she sits at the end, so the stay is the plan's.
    const last = this.phases[this.phases.length - 1];
    if (last) last.secs = Math.max(0.1, last.secs - (n * TILE_SIZE) / PET_WALK_SPEED_PX_PER_SEC);
    return true;
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
    if (this.rushed) {
      this.rushed = false;
      this.phases = [];
      this.timer = 0;
      this.setMode('sit');
      return;
    }
    if (this.chasing) {
      // The chase is over: she stands beside the ball and goes on with the rest of her stay.
      this.chasing = false;
      this.timer = 0;
      this.setMode('sit');
      return;
    }
    const kind = this.spot;
    this.dir = this.arriveDir ?? (kind === 'cafe' ? Direction.UP : Direction.DOWN);
    this.playDir = kind === 'ball' ? this.arriveDir : null;
    if (kind === null) {
      this.phases = [];
      this.timer = WANDER_MIN_SEC + w.rng() * (WANDER_MAX_SEC - WANDER_MIN_SEC);
      this.setMode('sit');
      return;
    }
    const stay = stayFor(kind, w.rng);
    this.phases = planFor(kind, stay, kind === 'ball' ? 1 + Math.floor(w.rng() * 2) : 1);
    this.begin(this.phases.shift()!);
  }

  /** Test hook: gives up what she is doing and goes to a spot of `kind` at once; false (and nothing changes) when it has none free now. */
  visit(kind: SpotKind, w: ProtonWorld): boolean {
    const here = key(this.col, this.row);
    const list = w.spots(kind).filter((s) => key(s.col, s.row) !== here);
    if (list.length === 0) return false;
    this.giveUp(false);
    return this.go(list[Math.floor(w.rng() * list.length) % list.length], kind, w);
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
    this.arriveDir = spot.face ?? null;
    this.face(path[0]);
    this.setMode('walk');
    return true;
  }
}
