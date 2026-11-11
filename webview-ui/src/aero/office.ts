/**
 * Aero's living office: idle and lunch routing, configured characters, hidden stock subagents and the wall objects.
 *
 * `OfficeState` owns one `AeroOffice` and calls it from a handful of places (see the fork's FORK notes in Aero):
 * `drive` instead of the stock character step, `afterTick` once a tick, `characters()` where the renderer takes its
 * characters, and `hides()` where a hit test or label would meet a hidden stock subagent. Without an update from Aero,
 * or in a layout without Aero's Lounge, every one of them is the stock behaviour.
 *
 * Characters here never touch `seat.assigned`: a rest seat is tracked in `routes`, so a layout rebuild or the stock
 * seat logic never has to know about it.
 */
import { playTubeSound } from '../notificationSound.js';
import { createCharacter, updateCharacter } from '../office/engine/characters.js';
import { advanceMatrixEffect, startMatrixEffect } from '../office/engine/matrixEffectState.js';
import type { OfficeState } from '../office/engine/officeState.js';
import type { ExtraSprite } from '../office/engine/renderer.js';
import { getCatalogEntry } from '../office/layout/furnitureCatalog.js';
import { findPath } from '../office/layout/tileMap.js';
import { getLoadedCharacterCount } from '../office/sprites/spriteData.js';
import type { Character, Seat } from '../office/types.js';
import { CharacterState, Direction, TILE_SIZE } from '../office/types.js';
import {
  type Activity,
  ACTIVITY_BUBBLE,
  activityOf,
  chainOf,
  PERMISSION_BUBBLE,
  readsAt,
} from './activity.js';
import { Effects, type FxKind } from './effects.js';
import {
  deskTile,
  HandoffBook,
  type HandoffParty,
  type HandoffStage,
  MAX_ACTIVE_HANDOFFS,
  planHandoff,
  podOriginMap,
  type QueuedHandoff,
} from './handoff.js';
import {
  clockPlateRect,
  findLounge,
  type Lounge,
  type LoungeItem,
  tableSpots,
  type Tile,
  type WallHit,
  wallHit,
  whiteboardRect,
} from './lounge.js';
import {
  facingPairs,
  HUDDLE_BUBBLES,
  HUDDLE_RETRY_SEC,
  HUDDLE_SEC,
  HUDDLE_WALK_SEC,
  pickPair,
  trackWorking,
  type Working,
} from './meetings.js';
import { assignFirstNames, lookKey, pickLook, roleFromSlug } from './names.js';
import {
  ATRIUM_HEAD,
  ballSpotDirs,
  CAFE_SPOTS,
  CARE_SPRITES,
  type CarePlan,
  carePlan,
  podOrigins,
  Proton,
  type ProtonArea,
  protonArea,
  type ProtonSpot,
  protonSpriteOf,
  type ProtonWorld,
  SPOT_KINDS,
  type SpotKind,
} from './proton.js';
import {
  BAR_SEC,
  BREAK_KINDS,
  type BreakKind,
  BUFFET_SEC,
  COFFEE_SEC,
  COOLER_SEC,
  foodFor,
  LUNCH_RECHECK_SEC,
  pickDelay,
  pickRoutine,
  pruneCooldowns,
  type RouteKind,
  type RoutePhase,
  smokeAllowed,
  smokeSeconds,
  TUBE_SEC,
  VENDING_SEC,
} from './routines.js';
import {
  type BreakSpot,
  buildStations,
  type Station,
  type StationBook,
  type StationGroup,
} from './stations.js';
import {
  type AeroFloor,
  type AeroHandoff,
  type AeroPods,
  type AeroUpdate,
  agentTypeFromStatus,
  MAX_AGENTS_PER_FLOOR,
  parseAeroUpdate,
  PR_RUNS_ROOM,
} from './update.js';

// ── The last update ────────────────────────────────────────────────

let latest: AeroUpdate | null = null;

/** Validate and keep an update. Returns whether it was accepted; a rejected one leaves the last in place. */
export function setAeroUpdate(raw: unknown): boolean {
  const parsed = parseAeroUpdate(raw);
  if (parsed === null) return false;
  latest = parsed;
  return true;
}

export function getAeroUpdate(): AeroUpdate | null {
  return latest;
}

const labelSets = new WeakMap<AeroPods, ReadonlySet<string>>();

/** The label keys of `pods`, built once per pods object (an update makes a new one). */
export function podLabelSet(pods: AeroPods): ReadonlySet<string> {
  let set = labelSets.get(pods);
  if (!set) {
    set = new Set(Object.keys(pods.labels));
    labelSets.set(pods, set);
  }
  return set;
}

const roomSets = new WeakMap<AeroFloor, ReadonlySet<string>>();

/** The rooms of `floor` as a set, built once per floor object (an update makes a new one). */
function floorRooms(floor: AeroFloor): ReadonlySet<string> {
  let set = roomSets.get(floor);
  if (!set) {
    set = new Set(floor.rooms);
    roomSets.set(floor, set);
  }
  return set;
}

const ownerShown = new WeakMap<AeroUpdate, ReadonlySet<string>>();

/**
 * The slugs of the owner's agents drawn on the floor on show: the roster has 16 at most, its own types first (the floor's, or with no
 * floor the rooms'), then the owner's types it lacks, in the order given, until 16. Built once per update (an update makes a new
 * object).
 */
function ownerSlugsShown(update: AeroUpdate): ReadonlySet<string> {
  let set = ownerShown.get(update);
  if (!set) {
    const floorId = update.floor?.id;
    const own = new Set<string>();
    for (const a of update.agents) {
      if (floorId !== undefined ? a.floor === floorId : a.room !== undefined) own.add(a.slug);
    }
    const shown = new Set<string>();
    for (const a of update.agents) {
      if (a.floor !== undefined || a.room !== undefined || own.has(a.slug)) continue;
      if (own.size + shown.size >= MAX_AGENTS_PER_FLOOR) break;
      shown.add(a.slug);
    }
    set = shown;
    ownerShown.set(update, set);
  }
  return set;
}

const wantedPeople = new WeakMap<AeroUpdate, ReadonlyMap<string, string>>();

/** The people an update wants, by `floor/room/slug`, to their names. Built once per update. */
function wantedOf(update: AeroUpdate): ReadonlyMap<string, string> {
  let map = wantedPeople.get(update);
  if (!map) {
    map = new Map(
      update.agents.map((a) => [personId(a.floor ?? null, a.room ?? null, a.slug), a.name]),
    );
    wantedPeople.set(update, map);
  }
  return map;
}

const personId = (floor: string | null, room: string | null, slug: string): string =>
  `${floor ?? ''}/${room ?? ''}/${slug}`;

/** @internal for tests */
export function resetAeroUpdate(): void {
  latest = null;
}

// ── Constants ──────────────────────────────────────────────────────

/** Ids of configured characters: far below any agent (>0), subagent (small negatives) and the greeter. */
export const PERSON_ID_BASE = -2_000_000_000;
const CHAT_MIN_SEC = 6;
const CHAT_MAX_SEC = 16;
const CHAT_SHOW_SEC = 3;
const CHAT_LINES = ['...', 'hm', 'ha!', 'ok', 'so...', 'brb'];
const ROUTE_RETRIES = 3;
const CANDIDATES_TRIED = 8;
/** A borrower keeps a station this many seconds (the tick clock) before it moves up to a better one or leaves it idle. */
const HOLD_SEC = 8;
/** A borrower that has not worked this long lets go of its station and goes to the water cooler. */
const IDLE_RELEASE_SEC = 20;
/** Where an effect's origin sits below the thing it plays on, in world pixels (the effects draw above their origin). */
const FX_BURST_DROP = 15;
const FX_COUNTDOWN_DROP = 0;
const FX_POOF_DROP = 8;
/** A break's effect plays this far above the front tile's centre, at the machine's spout or the ashtray's top. */
const FX_PROP_RISE = 12;
const BUBBLE_COOLER = '\u{1F4A7}';
const BUBBLE_COFFEE = '\u2615';
const BUBBLE_VENDING = '\u{1F964}';
const BUBBLE_VENDING_FUN = '\u{1F36B}';
const BUBBLE_SMOKE = '\u{1F6AC}';
const FUN_ZONE = 'Fun';
/** The tool that asks the owner a question: the lead is active while it waits, so the tool itself is the signal. */
const QUESTION_TOOL = 'AskUserQuestion';
/** The tube's capsule effect plays this far above the front tile's centre, at the receiver's breech. */
const FX_TUBE_RISE = 14;
/** The posts kept for the snapshot (the self-test reads them: a one-second stand can fall between two polls). */
const MAX_TUBE_POSTS = 32;

/** The front desk's chairs and people: one chair type, told apart by the layout's uids (an index suffix breaks on a reorder). */
const DESK_CHAIR_TYPE = 'CUSHIONED_CHAIR_FRONT';
const DESK_ROLES = [
  {
    role: 'receptionist',
    mark: '-reception-',
    id: PERSON_ID_BASE - 1_000_000,
    palette: 1,
    bubble: '\u{1F44B}',
  },
  {
    role: 'guard',
    mark: '-security-',
    id: PERSON_ID_BASE - 1_000_001,
    palette: 2,
    bubble: '\u{1FAAA}',
  },
] as const;
export type DeskRole = (typeof DESK_ROLES)[number]['role'];
const GREET_SHOW_SEC = 3;

/** Contractors: hired when every person of a roster type on the floor is busy, they come out of a lift and leave by it. */
const CONTRACTOR_CAP = 8;
const CONTRACTOR_IDLE_SEC = 120;
const CONTRACTOR_ID_BASE = PERSON_ID_BASE - 2_000_000;
const LIFT_TYPE = 'AERO_ELEVATOR';
const TURNSTILE_TYPE = 'AERO_TURNSTILE';
const TERRACE_LABEL = 'Terrace';
/** How far below its tile's centre she is drawn on a seat, as a seated person (a cat is lower on a sofa). */
const PROTON_SEAT_DROP_PX = 3;
const LIFT_WIDTH_FALLBACK = 2;

/** The receptionist or the guard: seated at a held chair, never in `characters`, `people` or any seat pick. */
export interface DeskNpc {
  role: DeskRole;
  seatUid: string;
  ch: Character;
  /** Seconds left of the greeting bubble; 0 when none shows. */
  greet: number;
  bubble: string;
}

export type RouteMode = 'rest' | 'lunch';

/** An effect a stage starts when the character gets there. */
export interface StageFx {
  kind: FxKind;
  x: number;
  y: number;
}

/** One place of a break: where, how it stands there, for how long, and what it shows. */
export interface Stage {
  target: Tile;
  /** The seat it sits on, or null when it stands. */
  seatUid: string | null;
  dir: Direction;
  /** Seconds it stays; `Infinity` while lunch lasts. */
  timer: number;
  fx: StageFx | null;
  bubble: string | null;
}

/**
 * Where an idle character goes. The Lounge route (`kind` absent or `'lounge'`) is as it always was; a break or lunch in the café
 * has a `kind`, a facing, a `timer` and, for the coffee machine and the buffet, a second `next` stage whose tile is reserved from
 * the start. Everything but the first five fields may be absent (a route made by hand).
 */
export interface Route {
  mode: RouteMode;
  target: Tile;
  /** The Lounge seat it sits on, or null when it stands. */
  seatUid: string | null;
  arrived: boolean;
  tries: number;
  kind?: RouteKind;
  /** Which way it faces at a break's target (the Lounge turns to the table). */
  dir?: Direction;
  /** Seconds left at the target before the next stage, the Lounge pick or the end of the break. */
  timer?: number;
  next?: Stage | null;
  /** Whether it is on the second stage (the bar stool, the café seat). */
  second?: boolean;
  fx?: StageFx | null;
  bubble?: string | null;
  /** A tube route: the need it answers (its kind and the lead's tool count), which place of the queue it holds, and whether it posted. */
  need?: string;
  slot?: number;
  posted?: boolean;
  /** A handoff route: the handoff, its stops, which one it is at, and whether the capsule is in hand. */
  hand?: HandoffRun;
}

/** A lead carrying a tower handoff (`handoff.ts` plans the stops). `done` once it was delivered or posted: a dropped walk is not queued again. */
interface HandoffRun {
  item: QueuedHandoff;
  stages: HandoffStage[];
  stage: number;
  carrying: boolean;
  done: boolean;
  /** The capsule was taken out of the tube (the effect and the whoosh played there; not again at the desk). */
  collected: boolean;
}

const kindOf = (route: Route): RouteKind => route.kind ?? 'lounge';

/** A break chosen but not yet walked to: its first stage, what comes after, and its kind. */
interface Plan extends Stage {
  kind: RouteKind;
  next: Stage | null;
}

/** What a snapshot says of a route: its kind, whether it is walking, at its target, on the bar stool or on a café seat, and where. */
export interface RoutineView {
  kind: RouteKind;
  phase: RoutePhase;
  col: number;
  row: number;
  seat: string | null;
}

/**
 * What a character that borrows a station has: the stock subagents, the people and the contractors. A station is a seat (`bench`, in
 * `borrowed`) or a prop front tile (`prop`, in `props`); never `seat.assigned`.
 */
export interface Worker {
  ch: Character;
  /** The seat it holds (borrowed, never `assigned`), or null. */
  bench: string | null;
  /** The tile it stands at before a prop (a bookshelf, the whiteboard), as `col,row`, or null. */
  prop: string | null;
  /** The group of the station it holds. */
  group: StationGroup | null;
  /** Which way it faces at its station. */
  faces: Direction;
  /** Whether it was sitting (working) at the last look (the PC it faces follows). */
  sitting: boolean;
  /** Its station was let go without it getting up (its floor left, or the layout was rebuilt): it stands up when it is next looked after. */
  stranded: boolean;
  /** What the world looked like when no station was found for it: no new search until that changes (see `benchSignature`). */
  noBench: string | null;
  /** The tick clock when it took its station. */
  heldAt: number;
  /** The tick clock when it stopped working (and no permission waits), or null while it works. */
  idleAt: number | null;
  /** The water cooler tile it was sent to while idle, or null. */
  cooler: Tile | null;
  /** What it does, by its type. */
  activity: Activity;
}

type StationState = Omit<Worker, 'ch'>;

const noStation = (activity: Activity): StationState => ({
  bench: null,
  prop: null,
  group: null,
  faces: Direction.DOWN,
  sitting: false,
  stranded: false,
  noBench: null,
  heldAt: 0,
  idleAt: null,
  cooler: null,
  activity,
});

/** The worker with every station field set (a person without them gets the defaults, in place). */
function fill(w: Worker | Person): Worker {
  const p = w as Partial<Worker>;
  // Complete (the usual case, and every worker the office makes): nothing is allocated.
  if (
    p.prop !== undefined &&
    p.group !== undefined &&
    p.faces !== undefined &&
    p.heldAt !== undefined &&
    p.idleAt !== undefined &&
    p.cooler !== undefined &&
    p.activity !== undefined
  ) {
    return w as Worker;
  }
  const o = w as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(noStation('type'))) if (o[k] === undefined) o[k] = v;
  return w as Worker;
}

/** The meeting two subagents of one lead are in: their ids, the seats they hold for it, and when it began and both sat. */
interface Huddle {
  subs: [number, number];
  seats: [string, string];
  workers: [Worker, Worker];
  startedAt: number;
  seatedAt: number | null;
  bubble: string;
}

/** A stock subagent at work (one no person stands in for). */
export interface SubWork extends Worker {
  subId: number;
}

/** The fields a person may lack (a person made by hand, as a test does): `fill` gives them their defaults before any station code looks. */
type StationExtras = 'prop' | 'group' | 'faces' | 'heldAt' | 'idleAt' | 'cooler' | 'activity';

export interface Person extends Omit<Worker, StationExtras>, Partial<Pick<Worker, StationExtras>> {
  slug: string;
  /** The floor (the repo's floor id) a project agent is staff of, or null (the owner's agents, and the rooms' agents). */
  floor: string | null;
  /** The worktree room an agent of the Rooms style belongs to, or null (a floor's staff, and the owner's agents). */
  room: string | null;
  name: string;
  /** The stock subagent character this one stands in for, while it is away. */
  subId: number | null;
  /** Walking home after an away trip: a poof when it gets there. */
  returning: boolean;
  /** Set on a contractor, hired for a floor whose people of the type were all busy; absent on a person. */
  contractor?: Contractor;
}

export interface Contractor {
  /** The `#N` in its name, 2 and up. */
  number: number;
  /** Seconds without work (page ticks); 0 while it works. */
  idle: number;
  /** Walking to the lift to leave: still reusable until its despawn starts. */
  leaving: boolean;
}

/** What a character is, for its name's role and its key. */
export type LabelKind = 'person' | 'contractor' | 'desk' | 'lead' | 'teammate' | 'subagent';

/** The name over a character: `first` and `role` make the line `Ava · Reviewer`. */
export interface NameLabel {
  id: number;
  kind: LabelKind;
  /** What the first name is made from: stable for the character (never a transcript's text). */
  key: string;
  palette: number;
  first: string;
  role: string;
}

const DESK_LABEL_ROLES: Record<DeskRole, string> = { receptionist: 'Reception', guard: 'Security' };

/** A subagent whose lead was off the floor on show when it started: matched when the lead's floor is shown. */
interface QueuedSubagent {
  parentId: number;
  toolId: string;
  type: string;
}

const MAX_QUEUED = 64;

interface Chat {
  /** Seconds until the next line; counts down while no line shows. */
  wait: number;
  text: string | null;
  show: number;
}

const key = (col: number, row: number): string => `${col},${row}`;

export class AeroOffice {
  lounge: Lounge | null = null;
  routes = new Map<number, Route>();
  /** The breaks of idle staff, by the person's character id (staff are not in `os.characters`, so not in `routes`). */
  staffRoutes = new Map<number, Route>();
  /** The tick clock when each character last started a smoke, and when each idle person picks its next place. */
  private smoked = new Map<number, number>();
  private pickAt = new Map<number, number>();
  private lunchWas = false;
  /** The need (see `needOf`) each lead has been sent to the tube for, until that need ends. */
  private tubeLatch = new Map<number, string>();
  /** Plays the whoosh when a capsule is posted: the page's sound, or what a test puts here. */
  tubeSound: () => void = () => {
    void playTubeSound();
  };
  /** How many capsules have been posted, and the last ones (who, and the tile they stood on). */
  private tubesPosted = 0;
  private tubePosts: Array<{ id: number; col: number; row: number }> = [];
  /** The tower handoffs: the queue, the capsules on desks and the deliveries (see `handoff.ts`). */
  handoffs = new HandoffBook();
  private handoffSeen: AeroUpdate | null = null;
  /** The tick clock when each lead last found a handoff of its own it could not walk to. */
  private handoffTried = new Map<number, number>();
  /** The top-left tile of each pod's label, found once per layout (`refreshProton`). */
  private podAt = new Map<string, Tile>();
  /** The tick clock when the waiting handoffs were last looked at again. */
  private waitingAt = -Infinity;
  people: Person[] = [];
  chats = new Map<number, Chat>();
  /** The effects (pixelfx) Aero starts: a burst on the whiteboard, a countdown on the clock, a poof at a person. */
  fx = new Effects();
  /** Seconds the office has run, from the ticks. */
  private clock = 0;
  /** Bumped whenever a route is made or dropped: a failed `assign` is tried again at once only after it changed. */
  private occupancy = 0;
  private failed = new Map<number, { at: number; occupancy: number }>();
  /** The update the effects last compared against, and the meetings a countdown already ran for. */
  private fxSeen: AeroUpdate | null = null;
  private countdowns = new Set<string>();
  /** Lounge floor tiles a character can walk on (not blocked). */
  loungeWalkable: Tile[] = [];
  rng: () => number = Math.random;

  /** The pod data last handed to the page's area mappings. */
  private podsApplied: unknown = null;

  /**
   * The characters that are not on the floor on show: hidden (not drawn, hit, routed or counted) and holding no seat. A set of
   * ids, kept in step by `syncMappings`, which every seat pick and every tick runs first.
   */
  private offFloor = new Set<number>();
  private syncing = false;

  /** The seats workers (people and stock subagents) work on: seat uid to the worker on it. Never `seat.assigned`. */
  private borrowed = new Map<string, Worker>();
  /** The prop front tiles workers stand at, `col,row` to the worker. */
  private props = new Map<string, Worker>();
  /** The stock subagents at work, by character id. */
  private subs = new Map<number, SubWork>();
  /** What each stock subagent does, by its type (set when its start names one). */
  private subActivity = new Map<number, Activity>();
  private book: StationBook | null = null;
  /** The meetings switch (on by default): the self-test turns it off for steps that count on subagents staying at their stations. */
  meetings = true;
  /** The meeting running, the subagents that have been in one (by subagent id), and how many have been held. */
  private huddle: Huddle | null = null;
  private met = new Set<number>();
  private huddlesHeld = 0;
  /** The worst handoff walker count and the tiles Proton stood on outside her area since the last `resetLatches` (`latchWorst`). */
  private worstWalkers = 0;
  private strayTiles = new Set<string>();
  /** Every tile she stood on since the last `resetLatches`, for the self-test to check against the layout itself. */
  private protonTiles = new Set<string>();
  /** Since when (the tick clock) each subagent has held a station and worked there, by subagent id. */
  private workingSince = new Map<number, number>();
  private huddleRetryAt = 0;
  private queued: QueuedSubagent[] = [];

  private cachedLayout: unknown = null;
  private cachedSeats: unknown = null;

  /** The front desk's people (a layout with the chairs has them) and the chairs they were found for. */
  npcs: DeskNpc[] = [];
  /** Greetings shown so far, per role (counted, so a short bubble isn't missed by a poll). */
  private greetings: Record<DeskRole, number> = { receptionist: 0, guard: 0 };
  private deskLayout: unknown = null;
  private deskSeats: unknown = null;
  private deskChairs: Array<{ role: DeskRole; uid: string }> = [];
  private nextPersonSlot = 0;
  /** The tiles in front of the lifts (the top row of each `AERO_ELEVATOR`, unblocked): where contractors arrive and leave. */
  lobby: Tile[] = [];
  /** Proton, the owner's cat: one for the office, whichever floor is on show. Made on the first tick she shows. */
  proton: Proton | null = null;
  /** Her tiles, her own blocked set and the spots that do not change with the layout (worked out in `refresh`). */
  private area: ProtonArea | null = null;
  private napSeats: Array<Tile & { seat: string }> = [];
  private fixedSpots: Record<'sun' | 'desk' | 'cafe' | 'eat' | 'drink' | 'litter', ProtonSpot[]> = {
    sun: [],
    desk: [],
    cafe: [],
    eat: [],
    drink: [],
    litter: [],
  };
  /** Her care corner (`refreshProton`): what the layout has room for, the keys of the tiles it blocks, the set they were added to and the ball. */
  private care: CarePlan = { bowls: [], litter: null, ball: null };
  private careKeys = new Set<string>();
  private careIn: Set<string> | null = null;
  private ball: Tile | null = null;

  private readonly os: OfficeState;

  constructor(os: OfficeState) {
    this.os = os;
  }

  // ── The layout ───────────────────────────────────────────────────

  /** Finds the Lounge again when the layout or its seats changed. */
  private refresh(): void {
    const os = this.os;
    if (this.cachedLayout === os.layout && this.cachedSeats === os.seats) {
      // Blocked tiles only change with a rebuild too; the walkable subset follows the same cache.
      return;
    }
    this.cachedLayout = os.layout;
    this.cachedSeats = os.seats;
    const items: LoungeItem[] = os.layout.furniture.map((f) => {
      const entry = getCatalogEntry(f.type);
      return {
        uid: f.uid,
        type: f.type,
        col: f.col,
        row: f.row,
        w: entry?.footprintW ?? 1,
        h: entry?.footprintH ?? 1,
      };
    });
    this.lounge = findLounge(items, os.seats, os.layout.areaTiles, os.layout.cols, os.layout.rows);
    const blocked = os.blockedTiles;
    this.loungeWalkable = this.lounge
      ? this.lounge.floor.filter((t) => !blocked.has(key(t.col, t.row)))
      : [];
    // Routes and people pointed at the old layout: every routed lead is routed again, and the people stand on the new Lounge floor.
    for (const id of [...this.routes.keys()]) {
      const ch = os.characters.get(id);
      this.dropRoute(id);
      if (ch) this.stand(ch);
    }
    for (const id of [...this.staffRoutes.keys()]) this.dropStaffRoute(id);
    this.failed.clear();
    const lift = os.layout.furniture.filter((f) => f.type === LIFT_TYPE);
    this.lobby = lift
      .flatMap((f) => {
        const w = getCatalogEntry(f.type)?.footprintW ?? LIFT_WIDTH_FALLBACK;
        return Array.from({ length: w }, (_, i) => ({ col: f.col + i, row: f.row }));
      })
      .filter((t) => !blocked.has(key(t.col, t.row)));
    this.refreshProton();
    this.book = buildStations(os);
    // The seats are new: borrowed stations are let go, and taken again by the tick.
    for (const loose of [...this.people, ...this.subs.values()]) {
      const w = fill(loose);
      if (w.bench !== null || w.prop !== null) {
        // Only the seat Aero lent: after a rebuild the stock code may have given a stock subagent one of its own.
        if (this.holdsBorrowed(w.ch)) w.ch.seatId = null;
        w.ch.aeroStanding = false;
        w.bench = null;
        w.prop = null;
        w.group = null;
        w.sitting = false;
        w.stranded = true;
      }
      w.cooler = null;
      w.noBench = null;
    }
    this.borrowed.clear();
    this.props.clear();
    this.os.refreshFurniture();
    this.rehomePeople();
  }

  // ── Proton ───────────────────────────────────────────────────────

  /**
   * Works out where Proton may go, once per layout: the labelled, unblocked, reachable tiles that are not the toilets, the lift lobby
   * or the turnstile throat, plus the sofa and Lounge seats beside them; her own blocked set; and the spots that stay put (the sun, a
   * pod's desks, the café). Her seat is dropped and her tile checked again: if it is no longer hers she is put on another.
   */
  private refreshProton(): void {
    const os = this.os;
    const types = new Map(os.layout.furniture.map((f) => [f.uid, f.type] as const));
    const baseType = (uid: string): string | undefined =>
      types.get(uid) ??
      (uid.includes(':') ? types.get(uid.slice(0, uid.lastIndexOf(':'))) : undefined);
    const sofas: Array<Tile & { seat: string }> = [];
    for (const seat of os.seats.values()) {
      const type = baseType(seat.uid);
      // A mirrored side sofa is written `SOFA_SIDE:left` (or `:right`): the same sofa.
      const sofa = type?.replace(/:(left|right)$/, '');
      if (sofa === 'SOFA_FRONT' || sofa === 'SOFA_SIDE') {
        sofas.push({ col: seat.seatCol, row: seat.seatRow, seat: seat.uid });
      }
    }
    const loungeSeats: Tile[] = [];
    for (const uid of this.lounge?.seats ?? []) {
      const seat = os.seats.get(uid);
      if (seat) loungeSeats.push({ col: seat.seatCol, row: seat.seatRow });
    }
    const turnstiles = os.layout.furniture
      .filter((f) => f.type === TURNSTILE_TYPE)
      .map((f) => {
        const entry = getCatalogEntry(f.type);
        return { col: f.col, row: f.row, w: entry?.footprintW ?? 1, h: entry?.footprintH ?? 2 };
      });
    const { cols, rows, areaTiles } = os.layout;
    this.podAt = podOriginMap(areaTiles, cols, rows);
    // The bowls and the litter box block people, like furniture: added to the layout's blocked tiles (a rebuilt layout has a new set, which
    // has none of them) and taken out of the walkable ones. The plan is worked out from the layout's own blocked tiles.
    const own =
      this.careIn === os.blockedTiles
        ? new Set([...os.blockedTiles].filter((k) => !this.careKeys.has(k)))
        : os.blockedTiles;
    // Only the open office has a care corner (it has turnstiles): a Rooms layout with a room named Café gets no invisible blocked tiles.
    this.care =
      turnstiles.length > 0
        ? carePlan({ cols, rows, areaTiles, blocked: own })
        : { bowls: [], litter: null, ball: null };
    this.careKeys = new Set(
      [...this.care.bowls.map((b) => b.bowl), ...(this.care.litter ? [this.care.litter] : [])].map(
        (t) => key(t.col, t.row),
      ),
    );
    for (const k of this.careKeys) os.blockedTiles.add(k);
    this.careIn = os.blockedTiles;
    if (this.careKeys.size > 0) {
      os.walkableTiles = os.walkableTiles.filter((t) => !this.careKeys.has(key(t.col, t.row)));
    }
    const area = protonArea({
      cols,
      rows,
      areaTiles,
      blocked: os.blockedTiles,
      lobby: this.lobby,
      turnstiles,
      sofaSeats: sofas,
      loungeSeats,
      boxes: this.care.litter ? [this.care.litter] : [],
    });
    this.area = area;
    this.napSeats = sofas.filter((s) => area.seats.has(key(s.col, s.row)));
    const inside = (tiles: readonly Tile[]): Tile[] =>
      tiles.filter((t) => area.walk.has(key(t.col, t.row)));
    const terrace: Tile[] = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (areaTiles?.[row * cols + col] === TERRACE_LABEL) terrace.push({ col, row });
      }
    }
    this.fixedSpots = {
      sun: inside([...terrace, ...ATRIUM_HEAD]),
      desk: inside(
        podOrigins(areaTiles, cols, rows).flatMap((o) => [
          { col: o.col + 2, row: o.row + 2 },
          { col: o.col + 4, row: o.row + 2 },
        ]),
      ),
      cafe: inside(CAFE_SPOTS),
      eat: this.bowlSpots('eat', area),
      drink: this.bowlSpots('drink', area),
      litter:
        this.care.litter !== null && area.seats.has(key(this.care.litter.col, this.care.litter.row))
          ? [{ ...this.care.litter }]
          : [],
    };
    // The ball stays where she left it; it goes back to its start when the layout leaves it outside her walk area.
    const start = this.care.ball;
    if (start === null || !area.walk.has(key(start.col, start.row))) this.ball = null;
    else if (this.ball === null || !area.walk.has(key(this.ball.col, this.ball.row))) {
      this.ball = { col: start.col, row: start.row };
    }
    const cat = this.proton;
    if (cat) {
      cat.giveUp(false);
      // She stands on a walk tile, not on a seat she no longer holds (nor off her area): the nearest one.
      if (!area.walk.has(key(cat.col, cat.row)))
        this.placeProton(cat, this.nearestWalk(cat.col, cat.row));
    }
  }

  /** Where she eats or drinks: the tile beside the bowl, facing it. */
  private bowlSpots(kind: 'eat' | 'drink', area: ProtonArea): ProtonSpot[] {
    return this.care.bowls
      .filter((b) => b.kind === kind && area.walk.has(key(b.from.col, b.from.row)))
      .map((b) => ({ col: b.from.col, row: b.from.row, face: b.face }));
  }

  /** The walk tile nearest (col, row) by Manhattan distance, the first in row order on a tie; null when she has no area. */
  private nearestWalk(col: number, row: number): Tile | null {
    let best: Tile | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const k of this.area?.walk ?? []) {
      const [c, r] = k.split(',').map(Number);
      const d = Math.abs(c - col) + Math.abs(r - row);
      if (d < bestDistance) {
        bestDistance = d;
        best = { col: c, row: r };
      }
    }
    return best;
  }

  /** Every tile Proton may be on: the walkable ones and the sofa and Lounge seats beside them. */
  protonAllowed(): ReadonlySet<string> {
    // Reading never refreshes her away: only when there is no area yet.
    if (!this.area) this.refresh();
    const out = new Set<string>();
    for (const k of this.area?.walk ?? []) out.add(k);
    for (const k of this.area?.seats ?? []) out.add(k);
    return out;
  }

  /** A random tile of her area (the injected rng), or null when she has none. */
  private randomWalkTile(): Tile | null {
    const tiles = [...(this.area?.walk ?? [])];
    if (tiles.length === 0) return null;
    const [col, row] = tiles[Math.floor(this.rng() * tiles.length) % tiles.length]
      .split(',')
      .map(Number);
    return { col, row };
  }

  /** Puts the cat on `tile`, or on a random tile of her area. */
  private placeProton(cat: Proton, tile: Tile | null = this.randomWalkTile()): void {
    if (tile) cat.place(tile);
  }

  /** She shows only with live pods and the Lounge on, so the Rooms style and an Aero that is off have no cat. */
  private protonOn(update: AeroUpdate | null): boolean {
    return (
      update !== null &&
      this.enabled() !== null &&
      this.podsInForce() &&
      !!this.area &&
      this.area.walk.size > 0
    );
  }

  /** Whether a nap seat is still hers to take: it exists, nobody holds it, no route or station targets it, nobody stands on it. */
  private napFree(uid: string, taken?: Set<string>): boolean {
    const seat = this.os.seats.get(uid);
    if (!seat || seat.assigned) return false;
    const k = key(seat.seatCol, seat.seatRow);
    if (!this.area?.seats.has(k)) return false;
    return !(taken ?? this.occupied(Number.NaN)).has(k);
  }

  private protonWorld(update: AeroUpdate): ProtonWorld {
    const area = this.area!;
    return {
      rng: () => this.rng(),
      lunch: update.lunch,
      blocked: area.blocked,
      tileMap: this.os.tileMap,
      walk: area.walk,
      spots: (kind) => this.protonSpots(kind),
      ball: this.ball,
      setBall: (tile) => {
        this.ball = { col: tile.col, row: tile.row };
      },
    };
  }

  /** The spots of a kind that are free now. */
  private protonSpots(kind: SpotKind): ProtonSpot[] {
    switch (kind) {
      case 'desk':
        return this.fixedSpots[kind];
      case 'sun':
      case 'cafe':
      case 'eat':
      case 'drink':
      case 'litter': {
        // The café's fronts and the terrace are where breaks are taken: not a tile somebody stands on or is walking to.
        const taken = this.occupied(Number.NaN);
        return this.fixedSpots[kind].filter((t) => !taken.has(key(t.col, t.row)));
      }
      case 'ball': {
        // Beside the ball with the ball straight ahead and room beyond it to roll: she bats it away from her.
        let ball = this.ball;
        if (ball === null || this.area === null) return [];
        let dirs = ballSpotDirs(this.area.walk, ball);
        // A ball nobody can bat from anywhere (a corner or a dead end) goes back to its start.
        const start = this.care.ball;
        if (dirs.length === 0 && start !== null) {
          ball = this.ball = { col: start.col, row: start.row };
          dirs = ballSpotDirs(this.area.walk, ball);
        }
        const taken = this.occupied(Number.NaN);
        const out: ProtonSpot[] = [];
        for (const face of dirs) {
          const dc = face === Direction.RIGHT ? 1 : face === Direction.LEFT ? -1 : 0;
          const dr = face === Direction.DOWN ? 1 : face === Direction.UP ? -1 : 0;
          if (!taken.has(key(ball.col - dc, ball.row - dr))) {
            out.push({ col: ball.col - dc, row: ball.row - dr, face });
          }
        }
        return out;
      }
      case 'sofa': {
        const taken = this.occupied(Number.NaN);
        return this.napSeats
          .filter((s) => this.napFree(s.seat, taken))
          .map((s) => ({ col: s.col, row: s.row, seat: s.seat }));
      }
      case 'agent': {
        const taken = this.occupied(Number.NaN);
        const workers: Character[] = [];
        for (const c of this.os.characters.values()) {
          if (!this.hides(c) && c.state === CharacterState.TYPE && c.matrixEffect !== 'despawn') {
            workers.push(c);
          }
        }
        for (const person of this.people) {
          if (this.personOnFloor(person) && person.ch.state === CharacterState.TYPE) {
            workers.push(person.ch);
          }
        }
        const out = new Map<string, ProtonSpot>();
        for (const w of workers) {
          for (const [dc, dr] of [
            [0, -1],
            [0, 1],
            [-1, 0],
            [1, 0],
          ] as const) {
            const col = w.tileCol + dc;
            const row = w.tileRow + dr;
            const k = key(col, row);
            if (this.area?.walk.has(k) && !taken.has(k)) out.set(k, { col, row });
          }
        }
        return [...out.values()];
      }
    }
  }

  /** Once a tick: she lets go of a seat that is wanted, then walks or waits. */
  private stepProton(dt: number, update: AeroUpdate | null): void {
    if (update === null || !this.protonOn(update)) return;
    let cat = this.proton;
    if (!cat) {
      const tile = this.randomWalkTile();
      if (!tile) return;
      // Made standing: she waits her first three seconds where she is placed.
      cat = new Proton(tile);
      this.proton = cat;
    }
    if (cat.seat !== null && !this.napFree(cat.seat)) cat.giveUp();
    // A spot somebody stands on or is walking to (a break, the tube's queue) is not hers: she gives up as she does for a seat.
    else if (cat.spot !== null) {
      const at = cat.spotTile();
      if (this.occupied(Number.NaN).has(key(at.col, at.row))) cat.giveUp();
    }
    const world = this.protonWorld(update);
    if (this.visiting !== null && cat.visit(this.visiting, world)) this.visiting = null;
    cat.update(dt, world);
  }

  /** The kind a test asked her to go to next (`protonVisit`), until she has a free spot of it. */
  private visiting: SpotKind | null = null;

  /** Test hook (e2e only): she gives up what she is doing and goes to a spot of `kind` as soon as one is free. False for a kind that doesn't exist. */
  protonVisit(kind: string): boolean {
    if (!(SPOT_KINDS as readonly string[]).includes(kind)) return false;
    this.visiting = kind as SpotKind;
    return true;
  }

  /** What the renderer draws for her, or null when she is not on show. */
  protonView(): ExtraSprite | null {
    const cat = this.proton;
    if (!cat || !this.protonOn(getAeroUpdate())) return null;
    const seated = cat.seat !== null && cat.mode !== 'walk';
    return {
      sprite: protonSpriteOf(cat.mode, cat.dir, cat.clock),
      x: cat.x,
      y: cat.y + (seated ? PROTON_SEAT_DROP_PX : 0),
      zY: cat.y + TILE_SIZE / 2,
    };
  }

  /** The extra sprites for the renderer: Proton, or none. */
  protonSprites(): ExtraSprite[] {
    const view = this.protonView();
    return view ? [view, ...this.careSprites()] : [];
  }

  /** Her bowls, the litter box and the ball, each at the bottom of its tile like her, sorted just under her own row. */
  private careSprites(): ExtraSprite[] {
    const at = (t: Tile, sprite: ExtraSprite['sprite']): ExtraSprite => ({
      sprite,
      x: t.col * TILE_SIZE + TILE_SIZE / 2,
      y: t.row * TILE_SIZE + TILE_SIZE / 2,
      zY: t.row * TILE_SIZE + TILE_SIZE - 1,
    });
    const out: ExtraSprite[] = [];
    for (const b of this.care.bowls) {
      out.push(at(b.bowl, b.kind === 'eat' ? CARE_SPRITES.food : CARE_SPRITES.water));
    }
    if (this.care.litter) out.push(at(this.care.litter, CARE_SPRITES.litter));
    if (this.ball) out.push(at(this.ball, CARE_SPRITES.ball));
    return out;
  }

  /**
   * Holds the front desk's chairs (`assigned`, so no seat pick, overflow stage or `closestFreeSeat` hands them out) and seats the
   * receptionist and the guard on them, facing down. Run first by every sync and by a layout build, so the chairs are held from the
   * moment the seats exist; a layout without the chairs (the Rooms style) has no desk people.
   */
  holdFrontDesk(): void {
    const os = this.os;
    if (this.deskLayout !== os.layout.furniture) {
      this.deskLayout = os.layout.furniture;
      this.deskSeats = null;
      this.deskChairs = [];
      for (const d of DESK_ROLES) {
        const f = os.layout.furniture.find(
          (x) => x.type === DESK_CHAIR_TYPE && x.uid.includes(d.mark),
        );
        if (f) this.deskChairs.push({ role: d.role, uid: f.uid });
      }
    }
    for (const c of this.deskChairs) {
      const seat = os.seats.get(c.uid);
      if (seat) seat.assigned = true;
    }
    if (this.deskSeats === os.seats) return;
    this.deskSeats = os.seats;
    const next: DeskNpc[] = [];
    for (const d of DESK_ROLES) {
      const chair = this.deskChairs.find((c) => c.role === d.role);
      const seat = chair ? os.seats.get(chair.uid) : undefined;
      if (!chair || !seat) continue;
      const kept = this.npcs.find((n) => n.role === d.role);
      const palettes = Math.max(1, getLoadedCharacterCount());
      const ch = kept?.ch ?? createCharacter(d.id, d.palette % palettes, chair.uid, seat, 0);
      ch.seatId = chair.uid;
      ch.isActive = false;
      ch.state = CharacterState.TYPE;
      ch.frame = 0;
      ch.dir = Direction.DOWN;
      ch.tileCol = seat.seatCol;
      ch.tileRow = seat.seatRow;
      ch.x = seat.seatCol * TILE_SIZE + TILE_SIZE / 2;
      ch.y = seat.seatRow * TILE_SIZE + TILE_SIZE / 2;
      next.push({
        role: d.role,
        seatUid: chair.uid,
        ch,
        greet: kept?.greet ?? 0,
        bubble: d.bubble,
      });
    }
    this.npcs = next;
  }

  /** A lead arrived on the floor (a real arrival, not a restore or a floor switch): the desk greets it. */
  greetArrival(): void {
    for (const npc of this.npcs) {
      npc.greet = GREET_SHOW_SEC;
      this.greetings[npc.role]++;
    }
  }

  /** The greeting bubble the NPC of `role` shows now, or null. */
  greetingFor(npc: DeskNpc): string | null {
    return npc.greet > 0 ? npc.bubble : null;
  }

  /** Whether the office has what the routing needs: an update that says there is a Lounge, and the Lounge itself. */
  private enabled(): AeroUpdate | null {
    const update = getAeroUpdate();
    if (!update || !update.lounge || !this.lounge) return null;
    return update;
  }

  // ── Leads ────────────────────────────────────────────────────────

  /**
   * One lead's step, in place of the stock one. `step` is the stock step (`updateCharacter` with the character's own
   * seat unblocked).
   */
  drive(ch: Character, dt: number, step: () => void): void {
    this.refresh();
    // Not on the floor on show: it stands where it is, unseen, until its floor is back.
    if (this.offFloor.has(ch.id)) {
      const w = this.subs.get(ch.id);
      if (w) this.releaseBench(w, false);
      this.leave(ch);
      return;
    }
    const update = this.enabled();
    if (ch.isSubagent || !update) {
      this.leave(ch);
      // A stock subagent at work borrows a station and faces it; one a person stands in for is hidden and stays as it is.
      if (ch.isSubagent && update && !ch.aeroHidden && this.os.subagentMeta.has(ch.id)) {
        const w = this.subWork(ch);
        this.tendWorker(w, ch.id);
        this.stepWorker(w, step);
        if (w.bench !== null) this.watchSitting(w);
        return;
      }
      step();
      return;
    }

    // A lead the owner is needed by walks to the tube station first; a question leaves the lead active, so this is before that branch.
    if (this.tubeStep(ch, dt, step)) return;
    // A lead with a tower handoff to carry walks it (a walking lead is not active as far as the stock step is concerned), unless the
    // owner is needed by it: that lead is held at its desk below, and carries nothing.
    const held = ch.bubbleType === 'permission' || this.tubeHeld(ch);
    if (!held && this.handoffStep(ch, dt, step)) return;

    if (ch.isActive) {
      this.leave(ch);
      step();
      return;
    }
    // Only a permission bubble holds an idle lead at its desk (and one that has been to the tube for its need). A question
    // (AskUserQuestion) is an active tool, so the lead is active and stays anyway; and `idle_prompt` reaches the page as a
    // finished turn with `awaitingInput` for every idle session, so that flag says nothing about the owner being needed.
    if (held) {
      this.leave(ch);
      if (ch.state === CharacterState.TYPE) {
        // At its desk, waiting: sit still.
        ch.frame = 0;
        return;
      }
      // Not at its desk yet: walk there as an active character would.
      ch.isActive = true;
      step();
      ch.isActive = false;
      return;
    }

    // Truly idle: the Lounge, or a break from it (or lunch in the café).
    const mode: RouteMode = update.lunch && this.lounge!.table.length > 0 ? 'lunch' : 'rest';
    let route: Route | null = this.routes.get(ch.id) ?? null;
    if (route && route.mode !== mode) {
      // Idle and lunch change over: it gets up first, then the new place is found.
      this.leave(ch);
      route = null;
    }
    if (!route) {
      if (this.backedOff(ch.id)) {
        step();
        return;
      }
      route = this.assign(ch, mode);
      if (!route) {
        this.failed.set(ch.id, { at: this.clock, occupancy: this.occupancy });
        step();
        return;
      }
      this.failed.delete(ch.id);
    }
    if (route.arrived) {
      this.settle(ch, route);
      if (kindOf(route) === 'lounge') this.chat(ch, route, dt);
      this.tickRoute(ch, route, dt, false);
      return;
    }
    step();
    this.watchWalk(ch, route, () => this.dropRoute(ch.id));
  }

  /** After the step of a character on its way: it arrives, or walks again, or (after three tries) gives the route up. */
  private watchWalk(ch: Character, route: Route, drop: () => void): void {
    if (ch.state === CharacterState.WALK) return;
    // The stock step ended the walk.
    if (ch.tileCol === route.target.col && ch.tileRow === route.target.row) {
      this.arrive(ch, route);
      return;
    }
    route.tries++;
    if (route.tries >= ROUTE_RETRIES) {
      drop();
      return;
    }
    this.walkTo(ch, route.target);
  }

  /** A failed `assign` is not tried again for a second, unless a route was made or dropped since. */
  private backedOff(id: number): boolean {
    const failed = this.failed.get(id);
    return (
      failed !== undefined && failed.occupancy === this.occupancy && this.clock - failed.at < 1
    );
  }

  private putRoute(id: number, route: Route): void {
    this.routes.set(id, route);
    this.occupancy++;
  }

  private dropRoute(id: number): void {
    const route = this.routes.get(id);
    // A trip that never posted is not a trip the need was answered by: the lead may be sent again.
    if (route && kindOf(route) === 'tube' && route.posted !== true) this.tubeLatch.delete(id);
    // A handoff that was not delivered or posted waits again (a few times at most).
    if (route?.hand && !route.hand.done)
      this.handoffs.requeue({ ...route.hand.item, collected: route.hand.collected });
    if (this.routes.delete(id)) this.occupancy++;
    this.chats.delete(id);
  }

  /** Stops the character where its tile is: no path, standing, on the tile's centre (as the stock walk ends). */
  private stand(ch: Character): void {
    ch.state = CharacterState.IDLE;
    ch.frame = 0;
    ch.frameTimer = 0;
    ch.wanderTimer = 0;
    ch.path = [];
    ch.moveProgress = 0;
    ch.x = ch.tileCol * TILE_SIZE + TILE_SIZE / 2;
    ch.y = ch.tileRow * TILE_SIZE + TILE_SIZE / 2;
  }

  /** The lead goes back to the stock rules: its route ends, whatever it was doing (sitting, standing or walking there) stops. */
  private leave(ch: Character): void {
    if (!this.routes.has(ch.id)) return;
    this.dropRoute(ch.id);
    this.stand(ch);
  }

  private occupied(except: number, withPeople = true, withTubeQueue = true): Set<string> {
    const taken = new Set<string>();
    for (const other of this.os.characters.values()) {
      if (other.id !== except && !this.offFloor.has(other.id)) {
        taken.add(key(other.tileCol, other.tileRow));
      }
    }
    if (withPeople) {
      for (const person of this.people) {
        if (person.ch.id !== except && this.personOnFloor(person))
          taken.add(key(person.ch.tileCol, person.ch.tileRow));
      }
    }
    const reserve = (route: Route): void => {
      taken.add(key(route.target.col, route.target.row));
      if (route.next) taken.add(key(route.next.target.col, route.next.target.row));
    };
    for (const [id, route] of this.routes) if (id !== except) reserve(route);
    // While anybody is on the way to the tube, all of its queue is spoken for: a break or the cat takes none of it.
    if (withTubeQueue && this.book?.tube) {
      for (const route of this.routes.values()) {
        if (kindOf(route) !== 'tube') continue;
        for (const t of this.book.tube.queue) taken.add(key(t.col, t.row));
        break;
      }
    }
    // The idle staff's breaks: a person on another floor holds no tile (its route is dropped when it is next looked at).
    for (const person of this.people) {
      const route = this.staffRoutes.get(person.ch.id);
      if (route && person.ch.id !== except && this.personOnFloor(person)) reserve(route);
    }
    // The stations the borrowers hold, or are walking to.
    for (const [uid, w] of this.borrowed) {
      const seat = this.os.seats.get(uid);
      if (seat && w.ch.id !== except) taken.add(key(seat.seatCol, seat.seatRow));
    }
    for (const [k, w] of this.props) if (w.ch.id !== except) taken.add(k);
    // The water cooler tiles workers were sent to, reserved from the moment they are sent.
    for (const w of this.subs.values()) {
      if (w.cooler && w.ch.id !== except) taken.add(key(w.cooler.col, w.cooler.row));
    }
    for (const person of this.people) {
      if (person.cooler && person.ch.id !== except)
        taken.add(key(person.cooler.col, person.cooler.row));
    }
    return taken;
  }

  /** A path to `target`, with the target's seat unblocked for the search. */
  private pathTo(ch: Character, target: Tile): Tile[] {
    const os = this.os;
    const k = key(target.col, target.row);
    const wasBlocked = os.blockedTiles.delete(k);
    const own = ch.seatId ? os.seats.get(ch.seatId) : undefined;
    const ownKey = own ? key(own.seatCol, own.seatRow) : null;
    const ownWasBlocked = ownKey !== null && os.blockedTiles.delete(ownKey);
    const path = findPath(
      ch.tileCol,
      ch.tileRow,
      target.col,
      target.row,
      os.tileMap,
      os.blockedTiles,
    );
    if (wasBlocked) os.blockedTiles.add(k);
    if (ownWasBlocked && ownKey !== null) os.blockedTiles.add(ownKey);
    return path;
  }

  private walkTo(ch: Character, target: Tile): boolean {
    if (ch.tileCol === target.col && ch.tileRow === target.row) {
      ch.path = [];
      return true;
    }
    const path = this.pathTo(ch, target);
    if (path.length === 0) return false;
    ch.path = path;
    ch.moveProgress = 0;
    ch.state = CharacterState.WALK;
    ch.frame = 0;
    ch.frameTimer = 0;
    return true;
  }

  /** Picks and starts a walk to a Lounge place for `mode`; null when the Lounge has no free place it can reach. */
  assign(ch: Character, mode: RouteMode): Route | null {
    const os = this.os;
    const lounge = this.lounge;
    if (!lounge) return null;
    // Lunch is in the café (the buffet, then a seat) while it has room; the Lounge's table takes the rest.
    if (mode === 'lunch') {
      const cafe = this.startLunch(ch, false);
      if (cafe) return cafe;
    }
    const taken = this.occupied(ch.id);
    const free = (t: Tile): boolean => !taken.has(key(t.col, t.row));
    const seatTile = (uid: string): Tile | null => {
      const s = os.seats.get(uid);
      return s && !s.assigned ? { col: s.seatCol, row: s.seatRow } : null;
    };

    const candidates: Array<{ target: Tile; seatUid: string | null }> = [];
    const seatCandidates = lounge.seats.flatMap((uid) => {
      const tile = seatTile(uid);
      return tile && free(tile) ? [{ target: tile, seatUid: uid }] : [];
    });
    const spotCandidates = (mode === 'lunch' ? tableSpots(lounge) : [])
      .filter((t) => free(t))
      .map((target) => ({ target, seatUid: null as string | null }));
    // A table spot can itself be a seat: use it as one.
    const spotsAsSeats = spotCandidates.map((c) => {
      const seat = seatCandidates.find(
        (s) => s.target.col === c.target.col && s.target.row === c.target.row,
      );
      return seat ?? c;
    });
    const floorCandidates = this.loungeWalkable
      .filter((t) => free(t))
      .map((target) => ({ target, seatUid: null as string | null }));
    const order =
      mode === 'lunch'
        ? [spotsAsSeats, seatCandidates, floorCandidates]
        : [seatCandidates, floorCandidates];
    for (const group of order) {
      const sorted = group
        .map((c) => ({
          c,
          d: Math.abs(c.target.col - ch.tileCol) + Math.abs(c.target.row - ch.tileRow),
        }))
        .sort((a, b) => a.d - b.d)
        .map((x) => x.c);
      candidates.push(...sorted.slice(0, CANDIDATES_TRIED));
    }

    for (const c of candidates) {
      const route: Route = {
        mode,
        kind: 'lounge',
        target: c.target,
        seatUid: c.seatUid,
        arrived: false,
        tries: 0,
      };
      if (c.target.col === ch.tileCol && c.target.row === ch.tileRow) {
        this.putRoute(ch.id, route);
        this.arrive(ch, route);
        return route;
      }
      if (this.walkTo(ch, c.target)) {
        this.putRoute(ch.id, route);
        this.chats.delete(ch.id);
        return route;
      }
    }
    this.dropRoute(ch.id);
    return null;
  }

  private arrive(ch: Character, route: Route): void {
    const os = this.os;
    route.arrived = true;
    ch.path = [];
    ch.moveProgress = 0;
    ch.x = route.target.col * TILE_SIZE + TILE_SIZE / 2;
    ch.y = route.target.row * TILE_SIZE + TILE_SIZE / 2;
    ch.tileCol = route.target.col;
    ch.tileRow = route.target.row;
    ch.frame = 0;
    ch.frameTimer = 0;
    const seat = route.seatUid ? os.seats.get(route.seatUid) : undefined;
    if (seat) {
      ch.state = CharacterState.TYPE;
      ch.dir = seat.facingDir;
    } else {
      ch.state = CharacterState.IDLE;
      ch.dir =
        kindOf(route) === 'lounge'
          ? (this.faceTable(route.target) ?? ch.dir)
          : (route.dir ?? ch.dir);
    }
    if (kindOf(route) === 'lounge') {
      this.chats.set(ch.id, {
        wait: this.between(CHAT_MIN_SEC, CHAT_MAX_SEC),
        text: null,
        show: 0,
      });
      route.timer = route.mode === 'lunch' ? LUNCH_RECHECK_SEC : pickDelay(this.rng);
    }
    // A break's effect plays where the character arrives, once.
    if (route.fx) {
      this.startFx(route.fx.kind, route.fx.x, route.fx.y);
      route.fx = null;
    }
    if (kindOf(route) === 'tube' && route.slot === 0) this.post(ch, route);
    if (route.hand) this.handoffArrived(ch, route, route.hand);
  }

  // ── The tube station ─────────────────────────────────────────────

  /**
   * What the owner is needed for, or null: a question (the `AskUserQuestion` tool, which also covers a permission bubble the same
   * tool brings) or a permission request. Two needs of one kind are told apart by a count: a question by the lead's tool starts, a
   * permission request by the bubble's appearances (a tool start that keeps the bubble is the same request). `currentTool` and the
   * bubble stay until the next tool or the end of the turn, so the count is what changes when the lead asks again.
   */
  private needOf(ch: Character): string | null {
    if (ch.currentTool === QUESTION_TOOL) return `question:${this.os.toolStarts.get(ch.id) ?? 0}`;
    if (ch.bubbleType === 'permission')
      return `permission:${this.os.permissionShows.get(ch.id) ?? 0}`;
    return null;
  }

  /** Whether `ch` has been to the tube for the need it has now (so it waits at its desk). */
  private tubeHeld(ch: Character): boolean {
    const need = this.needOf(ch);
    return need !== null && this.tubeLatch.get(ch.id) === need;
  }

  /**
   * A lead's step while the owner is needed. True when it handled the tick (it is on its way to, in the queue of, or at the tube);
   * false leaves the lead to the usual rules (no tube, no new need, the queue full, or a lead that is a teammate).
   */
  private tubeStep(ch: Character, dt: number, step: () => void): boolean {
    const tube = this.book?.tube;
    if (!tube || ch.leadAgentId !== undefined) return false;
    const need = this.needOf(ch);
    let route: Route | null = this.routes.get(ch.id) ?? null;
    if (route && kindOf(route) === 'tube') {
      // The need ended (a new tool, the end of the turn) or changed: back to the usual rules, or the new need's own trip.
      if (route.need !== need) {
        this.leave(ch);
        route = null;
      }
    } else {
      route = null;
    }
    if (!route) {
      if (need === null || this.tubeLatch.get(ch.id) === need || this.backedOff(ch.id))
        return false;
      route = this.startTube(ch, need, tube.queue);
      if (!route) {
        this.failed.set(ch.id, { at: this.clock, occupancy: this.occupancy });
        return false;
      }
      this.failed.delete(ch.id);
    }
    // The stock step would turn an active walker back to its seat at every tile.
    const was = ch.isActive;
    ch.isActive = false;
    if (route.arrived) {
      this.settleTube(ch, route);
      this.advanceTube(ch, route, dt, tube.queue);
    } else {
      step();
      this.watchWalk(ch, route, () => {
        this.dropRoute(ch.id);
        this.failed.set(ch.id, { at: this.clock, occupancy: this.occupancy });
      });
    }
    ch.isActive = was;
    return true;
  }

  /**
   * Starts the walk to the first free place of the queue behind every place another tube route holds (so a lead from its desk never
   * jumps ahead of one still walking to a place); null when none is free or can be reached.
   */
  private startTube(ch: Character, need: string, queue: Tile[]): Route | null {
    const taken = this.occupied(ch.id, true, false);
    let behind = 0;
    for (const [id, other] of this.routes) {
      if (id !== ch.id && kindOf(other) === 'tube')
        behind = Math.max(behind, (other.slot ?? 0) + 1);
    }
    for (const [slot, tile] of queue.entries()) {
      if (slot < behind) continue;
      if (taken.has(key(tile.col, tile.row))) continue;
      const here = ch.tileCol === tile.col && ch.tileRow === tile.row;
      const walkable = here || this.pathTo(ch, tile).length > 0;
      if (!walkable) continue;
      this.leave(ch);
      const route: Route = {
        mode: 'rest',
        kind: 'tube',
        target: { col: tile.col, row: tile.row },
        seatUid: null,
        dir: Direction.UP,
        timer: TUBE_SEC,
        bubble: null,
        arrived: false,
        tries: 0,
        need,
        slot,
        posted: false,
      };
      this.putRoute(ch.id, route);
      this.tubeLatch.set(ch.id, need);
      if (here) this.arrive(ch, route);
      else this.walkTo(ch, tile);
      return route;
    }
    return null;
  }

  /** Keeps a lead in the queue standing, facing the tube. */
  private settleTube(ch: Character, route: Route): void {
    ch.frame = 0;
    ch.path = [];
    ch.state = CharacterState.IDLE;
    ch.dir = route.dir ?? Direction.UP;
  }

  /** At the back of the queue the lead steps up to a free place in front of it; at the front it stands its second and leaves. */
  private advanceTube(ch: Character, route: Route, dt: number, queue: Tile[]): void {
    const slot = route.slot ?? 0;
    if (slot > 0) {
      const ahead = queue[slot - 1];
      if (this.occupied(ch.id, true, false).has(key(ahead.col, ahead.row))) return;
      route.slot = slot - 1;
      route.target = { col: ahead.col, row: ahead.row };
      route.arrived = false;
      route.tries = 0;
      this.occupancy++;
      if (!this.walkTo(ch, ahead)) {
        // Cannot get there: back to its place.
        const back = queue[slot];
        route.slot = slot;
        route.target = { col: back.col, row: back.row };
        route.arrived = true;
        return;
      }
      // One tile at most: it stands at once when the place is the tile it is on.
      if (ch.tileCol === ahead.col && ch.tileRow === ahead.row) this.arrive(ch, route);
      return;
    }
    route.timer = (route.timer ?? TUBE_SEC) - dt;
    if (route.timer <= 0) this.leave(ch);
  }

  /** The lead is at the front: the capsule goes up (the effect and the whoosh, once), and the post is counted. */
  private post(ch: Character, route: Route): void {
    if (route.posted === true) return;
    route.posted = true;
    route.timer = TUBE_SEC;
    this.tubesPosted++;
    this.tubePosts.push({ id: ch.id, col: route.target.col, row: route.target.row });
    if (this.tubePosts.length > MAX_TUBE_POSTS) this.tubePosts.shift();
    // The whoosh plays even when the effect is refused (Reduced Motion, four already running).
    this.startFx(
      'capsule',
      route.target.col * TILE_SIZE + TILE_SIZE / 2,
      route.target.row * TILE_SIZE + TILE_SIZE / 2 - FX_TUBE_RISE,
    );
    this.tubeSound();
  }

  // ── Tower handoffs ───────────────────────────────────────────────

  /** The lead of a room on the floor on show (the lowest id when there are two), or null. */
  private leadOf(room: string | null): Character | null {
    if (room === null) return null;
    let found: Character | null = null;
    for (const c of this.os.characters.values()) {
      if (c.isSubagent || c.leadAgentId !== undefined || c.directoryName !== room) continue;
      if (this.offFloor.has(c.id) || c.matrixEffect === 'despawn' || !c.seatId) continue;
      if (found === null || c.id < found.id) found = c;
    }
    return found;
  }

  private partyOf(lead: Character | null): HandoffParty | null {
    const seat = lead?.seatId ? this.os.seats.get(lead.seatId) : undefined;
    if (!lead || !seat) return null;
    return {
      home: { col: seat.seatCol, row: seat.seatRow },
      seatUid: lead.seatId ?? null,
      pod: this.podAt.get(this.os.seatZone(lead.seatId!) ?? '') ?? null,
    };
  }

  /** The tiles of the capsules on desks that are drawn: a receiver in a pod on the floor on show. */
  deskCapsules(): Array<{ seq: number; col: number; row: number }> {
    const out: Array<{ seq: number; col: number; row: number }> = [];
    for (const [seq, room] of this.handoffs.desk) {
      const pod = this.partyOf(this.leadOf(room))?.pod;
      if (pod) out.push({ seq, ...deskTile(pod) });
    }
    return out;
  }

  /** The leads carrying a capsule now, and where it is in world pixels (at the waist). */
  carriedCapsules(): Array<{ x: number; y: number }> {
    const out: Array<{ x: number; y: number }> = [];
    for (const [id, route] of this.routes) {
      const ch = this.os.characters.get(id);
      if (route.hand?.carrying && ch && !this.hides(ch)) out.push({ x: ch.x, y: ch.y - 8 });
    }
    return out;
  }

  private activeHandoffs(): number {
    let n = 0;
    for (const route of this.routes.values()) if (route.hand) n++;
    return n;
  }

  /** Whether somebody could carry the handoff now (a held tile does not count: that is only a wait). */
  private plannable(item: AeroHandoff): boolean {
    return (
      planHandoff({
        sender: this.partyOf(this.leadOf(item.fromRoom)),
        receiver: this.partyOf(this.leadOf(item.toRoom)),
        tube: this.book?.tube?.queue[0] ?? null,
        free: () => true,
      }) !== null
    );
  }

  /** A walk is over for good: no delivery, no requeue; the lead goes back to the usual rules (home). */
  private cancelHandoff(id: number, route: Route): void {
    if (route.hand) route.hand.done = true;
    const ch = this.os.characters.get(id);
    if (ch) this.leave(ch);
    else this.dropRoute(id);
  }

  /**
   * A new update: its handoffs are queued (once per floor and `seq`), and the first list of a floor only places capsules. An update
   * with no `handoffs` key says the board was not read yet: it is not a list, and uses up nothing. A walk whose `seq` left the list
   * is cancelled. Handoffs that waited for a carrier are looked at again, once a second.
   */
  private watchHandoffs(update: AeroUpdate | null): void {
    const latest = getAeroUpdate();
    if (latest !== this.handoffSeen) {
      this.handoffSeen = latest;
      if (!update || update.handoffs !== undefined) {
        const { reset, overflow } = this.handoffs.ingest(
          update?.floor?.id ?? '',
          update?.handoffs ?? [],
          (h) => this.plannable(h),
        );
        for (const [id, route] of [...this.routes]) {
          if (route.hand && (reset || !this.handoffs.isListed(route.hand.item.seq)))
            this.cancelHandoff(id, route);
        }
        for (const item of overflow) this.placeHandoff(item);
      }
    }
    if (this.handoffs.waiting.length > 0 && this.clock - this.waitingAt >= 1) {
      this.waitingAt = this.clock;
      this.handoffs.retryWaiting((h) => this.plannable(h));
    }
  }

  /** The queue is full: the capsule pops at the tube and is set on the receiver's desk, with no walk. */
  private placeHandoff(item: AeroHandoff): void {
    const front = this.book?.tube?.queue[0];
    const pod = this.partyOf(this.leadOf(item.toRoom))?.pod;
    if (front) {
      this.startFx(
        'capsule',
        front.col * TILE_SIZE + TILE_SIZE / 2,
        front.row * TILE_SIZE + TILE_SIZE / 2 - FX_TUBE_RISE,
      );
      this.tubeSound();
      // Nobody takes it to a desk here: it went up the tube, which is a post.
      if (!pod) this.tubesPosted++;
    }
    if (!pod) {
      this.handoffs.place(item);
      return;
    }
    const at = deskTile(pod);
    this.startFx(
      'burst',
      at.col * TILE_SIZE + TILE_SIZE / 2,
      at.row * TILE_SIZE + TILE_SIZE / 2 + FX_BURST_DROP,
    );
    this.handoffs.deliver(item, -1, at);
  }

  /**
   * A lead's step while a handoff is its to carry. True when it handled the tick; false leaves the lead to the usual rules (nothing
   * to carry, two are walking already, or a lead that is a teammate).
   */
  private handoffStep(ch: Character, dt: number, step: () => void): boolean {
    if (ch.leadAgentId !== undefined) return false;
    let route: Route | null = this.routes.get(ch.id) ?? null;
    if (route && !route.hand) route = null;
    if (!route) {
      if (this.handoffs.queue.length === 0) return false;
      if (this.clock - (this.handoffTried.get(ch.id) ?? -Infinity) < 1) return false;
      if (this.activeHandoffs() >= MAX_ACTIVE_HANDOFFS) return false;
      route = this.startHandoff(ch);
      if (!route) return false;
    }
    // The stock step would turn an active walker back to its seat at every tile.
    const was = ch.isActive;
    ch.isActive = false;
    if (route.arrived) {
      this.settle(ch, route);
      this.advanceHandoff(ch, route, dt);
    } else {
      step();
      this.watchWalk(ch, route, () => this.dropRoute(ch.id));
    }
    ch.isActive = was;
    return true;
  }

  /**
   * Takes the first waiting handoff this lead carries and starts its walk; null when there is none it can walk. A handoff nobody can
   * carry is parked outside the queue; one whose tile is held waits where it is.
   */
  private startHandoff(ch: Character): Route | null {
    const room = ch.directoryName ?? null;
    if (room === null || ch.isSubagent) return null;
    let taken: Set<string> | null = null;
    const free = (t: Tile): boolean => {
      taken ??= this.occupied(ch.id);
      return !taken.has(key(t.col, t.row));
    };
    const tube = this.book?.tube?.queue[0] ?? null;
    for (const item of [...this.handoffs.queue]) {
      if (item.fromRoom !== room && item.toRoom !== room) continue;
      const sender = this.leadOf(item.fromRoom);
      const receiver = this.leadOf(item.toRoom);
      const plan = planHandoff({
        sender: this.partyOf(sender),
        receiver: this.partyOf(receiver),
        tube,
        free,
        collected: item.collected === true,
      });
      if (plan === null) {
        this.handoffs.park(item);
        continue;
      }
      if ((plan.walker === 'sender' ? sender : receiver)?.id !== ch.id) continue;
      if (plan.busy) {
        // Its tile is held: it stays queued, and is looked at again in a second.
        this.handoffTried.set(ch.id, this.clock);
        continue;
      }
      const first = plan.stages[0];
      const here = ch.tileCol === first.tile.col && ch.tileRow === first.tile.row;
      if (!here && this.pathTo(ch, first.tile).length === 0) {
        // Not tried again for a second (the path may open).
        this.handoffTried.set(ch.id, this.clock);
        continue;
      }
      this.handoffs.take((q) => q === item);
      this.leave(ch);
      const collected = item.collected === true;
      const route: Route = {
        mode: 'rest',
        kind: 'handoff',
        target: { ...first.tile },
        seatUid: null,
        dir: first.dir,
        timer: first.pause,
        bubble: null,
        arrived: false,
        tries: 0,
        hand: {
          item,
          stages: plan.stages,
          stage: 0,
          carrying: plan.walker === 'sender' || collected,
          done: false,
          collected,
        },
      };
      this.putRoute(ch.id, route);
      if (here) this.arrive(ch, route);
      else this.walkTo(ch, first.tile);
      return route;
    }
    return null;
  }

  /** The walker is at a stop: the capsule is set down, posted or taken out of the tube, once. */
  private handoffArrived(ch: Character, route: Route, hand: HandoffRun): void {
    const stage = hand.stages[hand.stage];
    const at = { col: ch.tileCol, row: ch.tileRow };
    const fxAt = (kind: FxKind, tile: Tile, drop: number): void => {
      this.startFx(
        kind,
        tile.col * TILE_SIZE + TILE_SIZE / 2,
        tile.row * TILE_SIZE + TILE_SIZE / 2 + drop,
      );
    };
    if (stage.act === 'deliver') {
      hand.carrying = false;
      hand.done = true;
      this.handoffs.deliver(hand.item, ch.id, at);
      // A capsule taken out of the tube already had its effect and its whoosh there.
      if (!hand.collected) {
        fxAt('capsule', at, -FX_TUBE_RISE);
        this.tubeSound();
      }
      fxAt('burst', at, FX_BURST_DROP);
    } else if (stage.act === 'post') {
      hand.carrying = false;
      hand.done = true;
      this.handoffs.finish(hand.item.seq);
      this.post(ch, route);
    } else if (stage.act === 'collect') {
      hand.carrying = true;
      hand.collected = true;
      fxAt('capsule', at, -FX_TUBE_RISE);
      this.tubeSound();
    }
    route.timer = stage.pause;
  }

  /** At a stop: stands its pause, then goes on to the next stop, or is done at the last. */
  private advanceHandoff(ch: Character, route: Route, dt: number): void {
    const hand = route.hand!;
    route.timer = (route.timer ?? 0) - dt;
    if (route.timer > 0) return;
    if (hand.stage + 1 >= hand.stages.length) {
      hand.done = true;
      this.dropRoute(ch.id);
      return;
    }
    const next = hand.stages[++hand.stage];
    route.target = { ...next.tile };
    route.seatUid = next.seatUid;
    route.dir = next.dir;
    route.arrived = false;
    route.tries = 0;
    this.occupancy++;
    if (!this.walkTo(ch, next.tile)) {
      this.dropRoute(ch.id);
      return;
    }
    if (ch.tileCol === next.tile.col && ch.tileRow === next.tile.row) this.arrive(ch, route);
  }

  /** Keeps an arrived lead sitting or standing, whatever the stock step would do. */
  private settle(ch: Character, route: Route): void {
    const seat = route.seatUid ? this.os.seats.get(route.seatUid) : undefined;
    ch.frame = 0;
    ch.path = [];
    if (seat) {
      ch.state = CharacterState.TYPE;
      ch.dir = seat.facingDir;
    } else {
      ch.state = CharacterState.IDLE;
    }
  }

  private faceTable(from: Tile): Direction | null {
    const table = this.lounge?.table ?? [];
    let best: Tile | null = null;
    let bestD = Infinity;
    for (const t of table) {
      const d = Math.abs(t.col - from.col) + Math.abs(t.row - from.row);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    if (!best) return null;
    const dc = best.col - from.col;
    const dr = best.row - from.row;
    if (Math.abs(dc) >= Math.abs(dr) && dc !== 0) return dc > 0 ? Direction.RIGHT : Direction.LEFT;
    if (dr !== 0) return dr > 0 ? Direction.DOWN : Direction.UP;
    return null;
  }

  private between(min: number, max: number): number {
    return min + this.rng() * (max - min);
  }

  private chat(ch: Character, route: Route, dt: number): void {
    const chat = this.chats.get(ch.id);
    if (!chat) return;
    if (route.mode === 'lunch') {
      chat.text = null;
      return;
    }
    if (chat.text !== null) {
      chat.show -= dt;
      if (chat.show <= 0) {
        chat.text = null;
        chat.wait = this.between(CHAT_MIN_SEC, CHAT_MAX_SEC);
      }
      return;
    }
    chat.wait -= dt;
    if (chat.wait <= 0) {
      chat.text = CHAT_LINES[Math.floor(this.rng() * CHAT_LINES.length) % CHAT_LINES.length];
      chat.show = CHAT_SHOW_SEC;
    }
  }

  /** What a lead's bubble says: a food bubble at lunch, a line of chat now and then, else null. */
  bubbleFor(id: number): string | null {
    const route = this.routes.get(id);
    if (!route || !route.arrived) return null;
    if (kindOf(route) !== 'lounge') return route.bubble ?? null;
    if (route.mode === 'lunch') return '\u{1F35C}';
    return this.chats.get(id)?.text ?? null;
  }

  /** The break bubbles over idle staff on the floor on show (staff are not in `os.characters`, so the overlay asks for them here). */
  staffBubbles(): Array<{ ch: Character; text: string }> {
    const out: Array<{ ch: Character; text: string }> = [];
    for (const person of this.people) {
      const route = this.staffRoutes.get(person.ch.id);
      if (!route?.arrived || !route.bubble || person.ch.matrixEffect === 'despawn') continue;
      if (this.personOnFloor(person)) out.push({ ch: person.ch, text: route.bubble });
    }
    return out;
  }

  // ── Breaks ───────────────────────────────────────────────────────

  private dropStaffRoute(id: number): void {
    if (this.staffRoutes.delete(id)) this.occupancy++;
  }

  /** How many are out smoking on the floor on show (a lead's route is dropped when its floor leaves, a person's when it is next looked at). */
  smokerCount(): number {
    let n = 0;
    for (const route of this.routes.values()) if (kindOf(route) === 'smoke') n++;
    for (const person of this.people) {
      const route = this.staffRoutes.get(person.ch.id);
      if (route && kindOf(route) === 'smoke' && this.personOnFloor(person)) n++;
    }
    return n;
  }

  /** When a character picks its next place: the usual 25-45 s, and at once during lunch. */
  private nextPick(): number {
    return getAeroUpdate()?.lunch === true ? this.clock : this.clock + pickDelay(this.rng);
  }

  /** What the snapshot says of a route. */
  private viewOf(route: Route): RoutineView {
    const kind = kindOf(route);
    let phase: RoutePhase = 'at';
    if (!route.arrived) phase = 'walking';
    else if (route.seatUid !== null && kind === 'coffee') phase = 'bar';
    else if (route.seatUid !== null && kind === 'lunch') phase = 'seat';
    return {
      kind,
      phase,
      col: route.target.col,
      row: route.target.row,
      seat: route.seatUid ?? route.next?.seatUid ?? null,
    };
  }

  /** The break places of `kind` that `ch` could take now, nearest first; each stage's tile is free and none is a seat somebody holds. */
  private plansFor(ch: Character, kind: BreakKind | 'lunch', staff: boolean): Plan[] {
    const os = this.os;
    const book = this.book;
    // Breaks are the open office's: in the Rooms style a room named Café or Terrace is a worktree's, and its benches are no bar.
    if (!book || !this.podsInForce()) return [];
    const b = book.breaks;
    const taken = this.occupied(ch.id);
    const dist = (a: Tile, from: Tile = { col: ch.tileCol, row: ch.tileRow }): number =>
      Math.abs(a.col - from.col) + Math.abs(a.row - from.row);
    const nearest = <T extends Tile>(list: T[], from?: Tile): T[] =>
      list
        .map((t) => ({ t, d: dist(t, from) }))
        .sort((x, y) => x.d - y.d)
        .map((x) => x.t);
    const fronts = (list: BreakSpot[]): BreakSpot[] =>
      nearest(list.filter((t) => !taken.has(key(t.col, t.row))));
    const seats = (list: BreakSpot[]): BreakSpot[] =>
      list.filter((t) => {
        const seat = os.seats.get(t.key);
        return (
          !!seat && !seat.assigned && !this.borrowed.has(t.key) && !taken.has(key(t.col, t.row))
        );
      });
    // Whether a seat can be walked to from a counter or machine front (a walled-off stool is no second stage).
    const reach = (from: Tile, to: Tile): boolean => {
      if (from.col === to.col && from.row === to.row) return true;
      const k = key(to.col, to.row);
      const wasBlocked = os.blockedTiles.delete(k);
      const path = findPath(from.col, from.row, to.col, to.row, os.tileMap, os.blockedTiles);
      if (wasBlocked) os.blockedTiles.add(k);
      return path.length > 0;
    };
    const seatFrom = (list: BreakSpot[], front: Tile): BreakSpot | undefined =>
      nearest(list, front).find((s) => reach(front, s));
    const stage = (
      spot: BreakSpot,
      timer: number,
      bubble: string,
      fx: FxKind | null = null,
      rise = FX_PROP_RISE,
    ): Stage => ({
      target: { col: spot.col, row: spot.row },
      seatUid: spot.seat,
      dir: spot.dir,
      timer,
      bubble,
      fx: fx
        ? {
            kind: fx,
            x: spot.col * TILE_SIZE + TILE_SIZE / 2,
            y: spot.row * TILE_SIZE + TILE_SIZE / 2 - rise,
          }
        : null,
    });
    switch (kind) {
      case 'cooler': {
        // A lead goes to its own pod's cooler, staff to the nearest; a cooler a worker holds or heads for is not free.
        const list: Tile[] = staff ? nearest(book.coolers) : this.candidates('cooler', ch);
        return list
          .filter((t) => !taken.has(key(t.col, t.row)))
          .map((t) => ({
            kind,
            next: null,
            ...stage(
              {
                key: key(t.col, t.row),
                seat: null,
                col: t.col,
                row: t.row,
                dir: Direction.UP,
                zone: null,
              },
              COOLER_SEC,
              BUBBLE_COOLER,
            ),
          }));
      }
      case 'coffee': {
        const stools = seats(b.bar);
        return fronts(b.coffee).flatMap((front) => {
          const stool = seatFrom(stools, front);
          return stool
            ? [
                {
                  kind,
                  ...stage(front, COFFEE_SEC, BUBBLE_COFFEE, 'steam'),
                  next: stage(stool, BAR_SEC, BUBBLE_COFFEE),
                } as Plan,
              ]
            : [];
        });
      }
      case 'vending':
        return fronts(b.vending).map((front) => ({
          kind,
          next: null,
          ...stage(
            front,
            VENDING_SEC,
            front.zone === FUN_ZONE ? BUBBLE_VENDING_FUN : BUBBLE_VENDING,
          ),
        }));
      case 'smoke': {
        const stands = fronts(b.ashtrays).map((spot) => ({
          kind,
          next: null,
          ...stage(spot, 0, BUBBLE_SMOKE, 'smoke'),
        }));
        const benches = nearest(seats(b.terrace)).map((spot) => ({
          kind,
          next: null,
          ...stage(spot, 0, BUBBLE_SMOKE, 'smoke', FX_PROP_RISE / 2),
        }));
        return [...stands, ...benches].sort((x, y) => dist(x.target) - dist(y.target)) as Plan[];
      }
      case 'lunch': {
        const food = foodFor(ch.id);
        const places = seats([...b.bar, ...b.dining]);
        if (places.length === 0) return [];
        // The buffet first when a counter tile is free, then the seat nearest it; both reserved from the start.
        const counters = fronts(b.buffet);
        const buffet = counters.flatMap((front) => {
          const seat = seatFrom(places, front);
          return seat
            ? [
                {
                  kind,
                  ...stage(front, BUFFET_SEC, food),
                  next: stage(seat, Number.POSITIVE_INFINITY, food),
                } as Plan,
              ]
            : [];
        });
        if (buffet.length > 0) return buffet;
        return nearest(places).map((spot) => ({
          kind,
          next: null,
          ...stage(spot, Number.POSITIVE_INFINITY, food),
        }));
      }
    }
  }

  /** Starts walking `ch` to the first stage of `plan` and makes it its route (the old one is dropped); null when it cannot get there. */
  private startPlan(ch: Character, plan: Plan, mode: RouteMode, staff: boolean): Route | null {
    const at = ch.tileCol === plan.target.col && ch.tileRow === plan.target.row;
    if (!at && !this.walkTo(ch, plan.target)) return null;
    const route: Route = {
      mode,
      kind: plan.kind,
      target: plan.target,
      seatUid: plan.seatUid,
      dir: plan.dir,
      timer: plan.kind === 'smoke' ? smokeSeconds(this.rng) : plan.timer,
      next: plan.next,
      second: false,
      fx: plan.fx,
      bubble: plan.bubble,
      arrived: false,
      tries: 0,
    };
    if (staff) {
      this.staffRoutes.set(ch.id, route);
      this.occupancy++;
    } else {
      this.dropRoute(ch.id);
      this.putRoute(ch.id, route);
    }
    if (plan.kind === 'smoke') this.smoked.set(ch.id, this.clock);
    if (at) this.arrive(ch, route);
    return route;
  }

  /** Lunch in the café for `ch`: the buffet and a seat, or a seat; null when no seat is free (the Lounge table takes the rest). */
  private startLunch(ch: Character, staff: boolean): Route | null {
    for (const plan of this.plansFor(ch, 'lunch', staff).slice(0, CANDIDATES_TRIED)) {
      const route = this.startPlan(ch, plan, 'lunch', staff);
      if (route) return route;
    }
    return null;
  }

  /** Picks the next place for an idle character at the Lounge (or at home): a break by the weights, or none (false: it stays). */
  private pickBreak(ch: Character, staff: boolean): boolean {
    const plans: Partial<Record<BreakKind, Plan[]>> = {};
    const can: Partial<Record<BreakKind, boolean>> = {};
    for (const kind of BREAK_KINDS) {
      if (kind === 'smoke' && !smokeAllowed(this.smokerCount(), this.smoked.get(ch.id), this.clock))
        continue;
      plans[kind] = this.plansFor(ch, kind, staff);
      can[kind] = plans[kind]!.length > 0;
    }
    const kind = pickRoutine(this.rng, can);
    if (kind === 'lounge') return false;
    let list = plans[kind]!;
    // Two machines, or an ashtray and a bench: not always the nearest.
    if ((kind === 'vending' || kind === 'smoke') && list.length > 1) {
      const turn = Math.floor(this.rng() * list.length) % list.length;
      list = [...list.slice(turn), ...list.slice(0, turn)];
    }
    for (const plan of list.slice(0, CANDIDATES_TRIED)) {
      if (this.startPlan(ch, plan, 'rest', staff)) return true;
    }
    return false;
  }

  /** An arrived route's clock: the second stage, the next pick at the Lounge, or the end of the break. */
  private tickRoute(ch: Character, route: Route, dt: number, staff: boolean): void {
    if (route.timer === undefined) return;
    route.timer -= dt;
    if (route.timer > 0) return;
    if (route.next) {
      this.nextStage(ch, route, staff);
      return;
    }
    if (kindOf(route) === 'lounge') {
      if (route.mode === 'lunch') {
        if (!this.startLunch(ch, false)) route.timer = LUNCH_RECHECK_SEC;
      } else if (!this.pickBreak(ch, false)) route.timer = pickDelay(this.rng);
      return;
    }
    this.endBreak(ch, staff);
  }

  /** The coffee machine's turn is over: on to the bar stool; the buffet's: on to the café seat. */
  private nextStage(ch: Character, route: Route, staff: boolean): void {
    const stage = route.next!;
    route.next = null;
    route.second = true;
    route.target = stage.target;
    route.seatUid = stage.seatUid;
    route.dir = stage.dir;
    route.timer = stage.timer;
    route.fx = stage.fx;
    route.bubble = stage.bubble;
    route.arrived = false;
    route.tries = 0;
    if (ch.tileCol === stage.target.col && ch.tileRow === stage.target.row) this.arrive(ch, route);
    else if (!this.walkTo(ch, stage.target)) this.endBreak(ch, staff);
  }

  /** A break is over: a lead goes back to the stock rules (the Lounge is its next route), a person stands up and wanders home. */
  private endBreak(ch: Character, staff: boolean): void {
    if (!staff) {
      this.leave(ch);
      return;
    }
    this.dropStaffRoute(ch.id);
    this.stand(ch);
    ch.wanderTimer = 0.5;
    this.pickAt.set(ch.id, this.nextPick());
  }

  /** One step of an idle person at home: its break, or its next pick, else the stock wander over the Lounge floor. */
  private tendStaff(person: Person, dt: number, update: AeroUpdate | null, step: () => void): void {
    const ch = person.ch;
    const route = this.staffRoutes.get(ch.id);
    if (route) {
      if (update === null || route.mode !== (update.lunch ? 'lunch' : 'rest')) {
        this.endBreak(ch, true);
        step();
        return;
      }
      if (route.arrived) {
        this.settle(ch, route);
        this.tickRoute(ch, route, dt, true);
        return;
      }
      step();
      this.watchWalk(ch, route, () => this.dropStaffRoute(ch.id));
      return;
    }
    if (update === null) {
      step();
      return;
    }
    const at = this.pickAt.get(ch.id);
    if (at === undefined) this.pickAt.set(ch.id, this.nextPick());
    else if (this.clock >= at) {
      const started = update.lunch ? this.startLunch(ch, true) !== null : this.pickBreak(ch, true);
      if (started) return;
      this.pickAt.set(ch.id, update.lunch ? this.clock + LUNCH_RECHECK_SEC : this.nextPick());
    }
    step();
  }

  // ── Configured characters ───────────────────────────────────────

  /**
   * Puts the floor and the mappings in force once per change: characters that are no longer on the floor give up their seats,
   * an accepted update with new pods hands them to the office (which reseats leads live), and one without pods after pods gives
   * the server's mappings back; then the characters that came back to the floor are seated by the mappings, at once. Without
   * Aero's pods and floor nothing here runs.
   */
  syncMappings(): void {
    this.holdFrontDesk();
    if (this.syncing) return;
    this.syncing = true;
    try {
      const parked = this.parkOffFloor();
      // What the floor that was left held is free before anyone returning is placed.
      if (parked) {
        for (const person of this.people) {
          if (!this.personOnFloor(person)) this.releaseBench(person, false);
        }
      }
      this.snapReturningOnSwitch();
      const pods = getAeroUpdate()?.pods ?? null;
      if (pods !== this.podsApplied) {
        const first = this.podsApplied === null && pods !== null;
        this.podsApplied = pods;
        this.os.refreshMappings();
        // Leads seated before the pods were in force take their pod's bench now.
        if (first) this.os.upgradeToBenches();
      }
      const arrivals = this.arrivals;
      this.arrivals = [];
      this.os.placeArrivals(arrivals);
      for (const ch of arrivals) this.settleArrival(ch);
      for (const ch of arrivals) this.settleSubagent(ch);
      if (parked || arrivals.length > 0) this.os.refreshFurniture();
    } finally {
      this.syncing = false;
    }
  }

  /** The id of the floor on show at the last sync (null: none); undefined before the first. */
  private floorSeen: string | null | undefined = undefined;

  /**
   * When the floor on show changes, a person still walking home is placed on a free Lounge tile at once, standing, with no poof:
   * the owner's people are on every floor, so nobody should be seen finishing its walk on the new one.
   */
  private snapReturningOnSwitch(): void {
    const id = getAeroUpdate()?.floor?.id ?? null;
    const was = this.floorSeen;
    this.floorSeen = id;
    if (was === undefined || was === id) return;
    for (const person of this.people) {
      if (!person.returning || person.ch.matrixEffect === 'despawn') continue;
      const ch = person.ch;
      const spot = this.freeLoungeTile(person, person);
      if (spot) {
        ch.tileCol = spot.col;
        ch.tileRow = spot.row;
      }
      person.returning = false;
      this.stand(ch);
      ch.wanderTimer = 1;
    }
  }

  /** Characters whose floor came back since the last sync, in the order they are seated (leads, then the rest). */
  private arrivals: Character[] = [];

  // ── Floors ───────────────────────────────────────────────────────

  /** Whether the directory `room` is on the floor on show; true for every room when the update has no floor. */
  roomOnFloor(room: string | null | undefined): boolean {
    const floor = getAeroUpdate()?.floor;
    if (!floor) return true;
    if (room === null) return true;
    // The PR runs share one stub folder and are on every floor, whether or not the update lists it.
    if (room === PR_RUNS_ROOM) return true;
    return room !== undefined && floorRooms(floor).has(room);
  }

  /**
   * Whether `ch` is on the floor on show. A subagent and a teammate are where their lead is; a lead is on the floor of its
   * directory name, and one with no directory name is on none. Every character is on the floor when the update has none.
   */
  isOnFloor(ch: Character): boolean {
    return this.onFloor(ch);
  }

  private onFloor(ch: Character): boolean {
    if (!getAeroUpdate()?.floor) return true;
    let lead = ch;
    if (ch.isSubagent) {
      const parent = this.os.subagentMeta.get(ch.id)?.parentAgentId ?? ch.parentAgentId;
      const found = parent == null ? undefined : this.os.characters.get(parent);
      if (!found) return false;
      lead = found;
    }
    if (lead.leadAgentId !== undefined) lead = this.os.characters.get(lead.leadAgentId) ?? lead;
    return this.roomOnFloor(lead.directoryName ?? undefined);
  }

  /**
   * Whether a configured character is on the floor on show: while it stands in for a subagent it is where that subagent's lead is;
   * otherwise a floor's staff are on their floor, the Rooms style's by their room, and the owner's (with neither) on the floor on
   * show unless its roster already has the type or is full (see `ownerSlugsShown`).
   */
  personOnFloor(person: Person): boolean {
    if (person.subId !== null) {
      const sub = this.os.characters.get(person.subId);
      if (sub) return this.onFloor(sub);
    }
    return this.homeOnFloor(person);
  }

  /** Whether a configured character at home would be on the floor on show. */
  private homeOnFloor(person: Person): boolean {
    const update = getAeroUpdate();
    const floor = update?.floor;
    if (person.contractor) return person.floor === (floor?.id ?? null);
    if (person.floor !== null) return !floor || floor.id === person.floor;
    if (person.room !== null) return this.roomOnFloor(person.room);
    return !update || ownerSlugsShown(update).has(person.slug);
  }

  /**
   * A lead that comes back to the floor idle goes straight to the place its route would take it to (the Lounge, or the table at
   * lunch), not to its desk first and from there across the floor.
   */
  private settleArrival(ch: Character): void {
    if (ch.isSubagent || ch.leadAgentId !== undefined || !ch.seatId || ch.isActive) return;
    if (ch.bubbleType === 'permission' || this.tubeHeld(ch) || ch.matrixEffect === 'despawn')
      return;
    this.refresh();
    const update = this.enabled();
    if (!update || !this.lounge) return;
    const mode: RouteMode = update.lunch && this.lounge.table.length > 0 ? 'lunch' : 'rest';
    const route = this.assign(ch, mode);
    if (route && !route.arrived) this.arrive(ch, route);
  }

  /**
   * A stock subagent that comes back to the floor with its lead stands by the lead's seat (the free tile nearest it, else the lead's
   * tile), not where it stood when the floor was left. One a person stands in for stays hidden where it is.
   */
  private settleSubagent(ch: Character): void {
    if (!ch.isSubagent || ch.aeroHidden || ch.matrixEffect === 'despawn') return;
    const parent = this.os.subagentMeta.get(ch.id)?.parentAgentId ?? ch.parentAgentId;
    const lead = parent == null ? undefined : this.os.characters.get(parent);
    if (!lead) return;
    const seat = lead.seatId ? this.os.seats.get(lead.seatId) : undefined;
    const anchor = seat
      ? { tileCol: seat.seatCol, tileRow: seat.seatRow }
      : { tileCol: lead.tileCol, tileRow: lead.tileRow };
    this.dropRoute(ch.id);
    const spot = this.nearestFreeTile(anchor, ch.id) ?? {
      col: anchor.tileCol,
      row: anchor.tileRow,
    };
    ch.tileCol = spot.col;
    ch.tileRow = spot.row;
    this.stand(ch);
    // Handed to the router: it is at its station at once, as a lead is put on its seat.
    // An idle one (between its turns) is not seated at work: it stands there until it works again.
    if (this.enabled() && lead.seatId) {
      const w = this.subWork(ch);
      this.releaseBench(w, false);
      w.stranded = false;
      w.noBench = null;
      if (ch.isActive) this.takeStation(w, lead, this.chainFor(w, lead), true);
    }
  }

  /** Whether any character is on another floor than the one on show. */
  hasOffFloor(): boolean {
    return this.offFloor.size > 0;
  }

  /** Whether the character is on another floor than the one on show. */
  isOffFloor(id: number): boolean {
    return this.offFloor.has(id);
  }

  /** Whether `ch` is not drawn, hit-tested, routed or counted: a stock subagent a person stands in for, or a character of another floor. */
  hides(ch: Character): boolean {
    return ch.aeroHidden === true || this.offFloor.has(ch.id);
  }

  /**
   * Finds who is off the floor now: those who just left give up their seats and route, those who are back are queued to be seated,
   * and the selection, hover and camera follow drop a character that is off the floor. Returns whether anything changed.
   */
  private parkOffFloor(): boolean {
    const os = this.os;
    let changed = false;
    for (const id of [...this.offFloor]) {
      if (!os.characters.has(id)) this.offFloor.delete(id);
    }
    for (const ch of os.characters.values()) {
      if (ch.matrixEffect === 'despawn') continue;
      const off = !this.onFloor(ch);
      const was = this.offFloor.has(ch.id);
      if (off && !was) {
        this.offFloor.add(ch.id);
        this.dropRoute(ch.id);
        this.dropBorrowed(ch);
        os.releaseSeat(ch);
        changed = true;
      } else if (off && ch.seatId) {
        // A hidden character holds no seat, however it came by one (a seat pick, a teammate link).
        this.dropBorrowed(ch);
        os.releaseSeat(ch);
        changed = true;
      } else if (!off && was) {
        this.offFloor.delete(ch.id);
        this.arrivals.push(ch);
        changed = true;
      }
    }
    // Leads before the characters that sit near them.
    this.arrivals.sort(
      (a, b) => Number(a.leadAgentId !== undefined) - Number(b.leadAgentId !== undefined),
    );
    for (const id of [os.selectedAgentId, os.cameraFollowId, os.hoveredAgentId]) {
      if (id !== null && this.offFloor.has(id)) {
        if (os.selectedAgentId === id) os.selectedAgentId = null;
        if (os.cameraFollowId === id) os.cameraFollowId = null;
        if (os.hoveredAgentId === id) os.hoveredAgentId = null;
      }
    }
    return changed;
  }

  /** Whether an accepted update's live pods are in force (the seat rules for the open office run only then). */
  podsInForce(): boolean {
    return getAeroUpdate()?.pods !== undefined;
  }

  /** Sub-steps a frame runs: the update's `timeScale` (the self-test's), else 1. */
  timeScale(): number {
    return getAeroUpdate()?.timeScale ?? 1;
  }

  /**
   * Once a tick, after every character stepped. A frame at a time scale runs several ticks: `frameStart` is true for the first only, so
   * the work that follows the static update (not time) runs once a frame.
   */
  afterTick(dt: number, frameStart = true): void {
    if (frameStart) {
      this.syncMappings();
      this.refresh();
    }
    this.clock += dt;
    const update = this.enabled();
    for (const id of [...this.routes.keys()]) {
      if (!this.os.characters.has(id)) this.dropRoute(id);
    }
    for (const id of [...this.failed.keys()]) {
      if (!this.os.characters.has(id)) this.failed.delete(id);
    }
    for (const id of [...this.handoffTried.keys()]) {
      if (!this.os.characters.has(id)) this.handoffTried.delete(id);
    }
    // A lead whose need ended may be sent again by the next one; gone leads are forgotten (not in `drive`, which returns early for a
    // lead off the floor).
    for (const id of [...this.tubeLatch.keys()]) {
      const lead = this.os.characters.get(id);
      if (!lead || this.needOf(lead) === null) this.tubeLatch.delete(id);
    }
    for (const id of [...this.os.toolStarts.keys()]) {
      if (!this.os.characters.has(id)) this.os.toolStarts.delete(id);
    }
    for (const id of [...this.os.permissionShows.keys()]) {
      if (!this.os.characters.has(id)) this.os.permissionShows.delete(id);
    }
    // Staff routes, picks and smoke cooldowns of people who are gone are forgotten; lunch starting or ending sends everybody to look again.
    const here = new Set(this.people.map((p) => p.ch.id));
    for (const id of [...this.staffRoutes.keys()]) if (!here.has(id)) this.dropStaffRoute(id);
    for (const id of [...this.pickAt.keys()]) if (!here.has(id)) this.pickAt.delete(id);
    pruneCooldowns(this.smoked, this.clock);
    const lunch = update?.lunch === true;
    if (lunch !== this.lunchWas) {
      this.lunchWas = lunch;
      // Lunch starting picks at once; lunch ending waits a pick's time like any other.
      for (const id of this.pickAt.keys())
        this.pickAt.set(id, lunch ? this.clock : this.nextPick());
    }
    this.sweepSubs();
    this.reconcilePeople(update);
    this.matchQueued();
    this.watchUpdate(update);
    this.watchHandoffs(update);
    for (const person of [...this.people]) this.stepPerson(person, dt);
    this.tendHuddle();
    this.stepProton(dt, update);
    this.fx.update(dt);
    for (const npc of this.npcs) npc.greet = Math.max(0, npc.greet - dt);
    this.latchWorst();
  }

  /** Starts a window the self-test checks: the latches below are emptied here and by nothing else (a snapshot only reads them). */
  resetLatches(): void {
    this.worstWalkers = 0;
    this.strayTiles.clear();
    this.protonTiles.clear();
  }

  /**
   * What the self-test looks for between two polls, kept from every sub-step (a sped-up frame runs several, so a reading would miss the
   * worst): the most handoff walkers at once and the tiles Proton stood on that are not hers. Read by `snapshot` and cleared only by `resetLatches`.
   */
  private latchWorst(): void {
    this.worstWalkers = Math.max(this.worstWalkers, this.activeHandoffs());
    const cat = this.proton;
    if (cat && this.area && this.protonOn(getAeroUpdate())) {
      const k = key(cat.col, cat.row);
      if (!this.area.walk.has(k) && !this.area.seats.has(k) && this.strayTiles.size < 64)
        this.strayTiles.add(k);
      if (this.protonTiles.size < 256) this.protonTiles.add(k);
    }
  }

  // ── Effects (pixelfx) ───────────────────────────────────────────

  /** Starts an effect at world point (x, y), seeded from the office's rng. */
  private startFx(kind: FxKind, x: number, y: number): boolean {
    return this.fx.start(kind, x, y, Math.floor(this.rng() * 0x7fffffff));
  }

  /**
   * Compares a new update with the last one: a burst on the whiteboard when the inbox rose, a countdown on the clock when the
   * next meeting is within five minutes (once per meeting).
   */
  private watchUpdate(update: AeroUpdate | null): void {
    const latest = getAeroUpdate();
    if (latest === this.fxSeen) return;
    const previous = this.fxSeen;
    this.fxSeen = latest;
    if (!update || !this.lounge) return;
    if (previous !== null && update.inbox > previous.inbox && this.lounge.whiteboard) {
      const r = whiteboardRect(this.lounge.whiteboard);
      this.startFx('burst', r.x + r.w / 2, r.y + r.h / 2 + FX_BURST_DROP);
    }
    const meeting = update.meeting;
    if (meeting?.soon === true && this.lounge.clock) {
      const id = `${meeting.time} ${meeting.title}`;
      if (!this.countdowns.has(id)) {
        if (this.countdowns.size >= 64) this.countdowns.clear();
        this.countdowns.add(id);
        const r = clockPlateRect(this.lounge.clock);
        this.startFx('countdown', r.x + r.w / 2, r.y + r.h / 2 + FX_COUNTDOWN_DROP);
      }
    }
  }

  /** A poof at a person's feet. */
  private poofAt(ch: Character): void {
    this.startFx('poof', ch.x, ch.y + FX_POOF_DROP);
  }

  private reconcilePeople(update: AeroUpdate | null): void {
    const idOf = personId;
    const wanted: ReadonlyMap<string, string> = update ? wantedOf(update) : new Map();
    const have = new Set<string>();
    for (const person of this.people) {
      if (person.contractor) continue;
      const id = idOf(person.floor, person.room, person.slug);
      const name = wanted.get(id);
      if (name === undefined) {
        if (person.ch.matrixEffect !== 'despawn') {
          this.unhide(person);
          this.dropStaffRoute(person.ch.id);
          this.releaseBench(person, false);
          person.subId = null;
          startMatrixEffect(person.ch, 'despawn');
        }
      } else {
        person.name = name;
        if (person.ch.matrixEffect !== 'despawn') have.add(id);
      }
    }
    if (!update) return;
    // The looks of those about to be made, in key order, each the next free palette of its floor (no tint while palettes last).
    const palettes = Math.max(1, getLoadedCharacterCount());
    const scopeOf = (floor: string | null, room: string | null): string =>
      `${floor ?? ''}/${room ?? ''}`;
    const usedLooks = new Map<string, Set<string>>();
    for (const p of this.people) {
      if (p.contractor || p.ch.matrixEffect === 'despawn') continue;
      const scope = scopeOf(p.floor, p.room);
      let set = usedLooks.get(scope);
      if (!set) usedLooks.set(scope, (set = new Set()));
      set.add(lookKey(p.ch.palette, p.ch.hueShift));
    }
    const looks = new Map<string, { palette: number; hue: number }>();
    const missing = update.agents
      .map((a) => ({ key: idOf(a.floor ?? null, a.room ?? null, a.slug), a }))
      .filter((m) => !have.has(m.key))
      .sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
    for (const { key, a } of missing) {
      const scope = scopeOf(a.floor ?? null, a.room ?? null);
      let set = usedLooks.get(scope);
      if (!set) usedLooks.set(scope, (set = new Set()));
      const look = pickLook(key, palettes, set);
      set.add(lookKey(look.palette, look.hue));
      looks.set(key, look);
    }
    for (const agent of update.agents) {
      const floor = agent.floor ?? null;
      const room = agent.room ?? null;
      if (have.has(idOf(floor, room, agent.slug))) continue;
      const spot = this.freeLoungeTile({ floor, room });
      if (!spot) continue;
      const slot = this.nextPersonSlot++;
      // The look follows the person's key and its floor's other people, not the order it was made in.
      const look = looks.get(idOf(floor, room, agent.slug)) ?? { palette: 0, hue: 0 };
      const ch = createCharacter(PERSON_ID_BASE - slot, look.palette, null, null, look.hue);
      ch.isActive = false;
      ch.state = CharacterState.IDLE;
      ch.dir = Direction.DOWN;
      ch.x = spot.col * TILE_SIZE + TILE_SIZE / 2;
      ch.y = spot.row * TILE_SIZE + TILE_SIZE / 2;
      ch.tileCol = spot.col;
      ch.tileRow = spot.row;
      ch.wanderTimer = 1 + this.rng() * 4;
      startMatrixEffect(ch, 'spawn');
      this.people.push({
        slug: agent.slug,
        floor,
        room,
        name: agent.name,
        ch,
        subId: null,
        returning: false,
        ...noStation(activityOf(agent.slug)),
      });
    }
  }

  /** Shows the stock subagent a configured character stood in for again. */
  private unhide(person: Person): void {
    if (person.subId === null) return;
    const sub = this.os.characters.get(person.subId);
    if (sub) sub.aeroHidden = false;
  }

  /**
   * A free Lounge tile for a person of `home`'s floor or room. Everyone at home that can be shown with it holds its tile, seen or
   * not (its own floor's or room's people, and the owner's, which are on every floor; with no floor on show, all of them), so
   * people do not stack when their floor comes round; the shown people of another floor do not count. When that leaves no tile, the
   * tiles of the people shown now are all it counts.
   */
  private freeLoungeTile(
    home?: { floor: string | null; room: string | null },
    self?: Person,
  ): Tile | null {
    const taken = this.occupied(Number.NaN);
    // The tiles the characters hold, and, of the people, only those that can be shown with this one (not the shown people of
    // another floor, whom this one is never seen beside).
    const strict = home ? this.occupied(Number.NaN, false) : new Set(taken);
    if (home) {
      const sharedWith = (other: Person): boolean => {
        if (!getAeroUpdate()?.floor) return true;
        const owner = (p: { floor: string | null; room: string | null }) =>
          p.floor === null && p.room === null;
        if (owner(home) || owner(other)) return true;
        return (
          (home.floor !== null && other.floor === home.floor) ||
          (home.room !== null && other.room === home.room)
        );
      };
      for (const other of this.people) {
        if (other === self || other.subId !== null || other.ch.matrixEffect === 'despawn') continue;
        if (sharedWith(other)) strict.add(key(other.ch.tileCol, other.ch.tileRow));
      }
    }
    const pick = (blocked: Set<string>): Tile | null => {
      const free = this.loungeWalkable.filter((t) => !blocked.has(key(t.col, t.row)));
      if (free.length === 0) return null;
      return free[Math.floor(this.rng() * free.length) % free.length];
    };
    return pick(strict) ?? pick(taken);
  }

  private stepPerson(person: Person, dt: number): void {
    const os = this.os;
    const ch = person.ch;
    const effect = advanceMatrixEffect(ch, dt);
    if (effect !== 'none') {
      if (effect === 'despawned') this.people = this.people.filter((p) => p !== person);
      // A contractor out of the lift is greeted at the front desk, when it is seen arriving.
      else if (effect === 'spawned' && person.contractor && this.personOnFloor(person))
        this.greetArrival();
      return;
    }
    // Its stand-in is gone: walk back to the Lounge, or, with nobody looking, be there at once.
    if (person.subId !== null && !os.subagentMeta.has(person.subId)) {
      person.subId = null;
      // Seen by where its home is (it was where the stand-in's lead is a moment ago).
      const visible = this.personOnFloor(person);
      this.releaseBench(person, false);
      ch.isActive = false;
      ch.bubbleType = null;
      ch.aeroReading = undefined;
      person.cooler = null;
      const spot = this.freeLoungeTile(person, person);
      ch.state = CharacterState.IDLE;
      ch.wanderTimer = 0.5;
      if (!visible) {
        person.returning = false;
        if (spot) {
          ch.tileCol = spot.col;
          ch.tileRow = spot.row;
        }
        this.stand(ch);
        ch.wanderTimer = 0.5;
      } else {
        person.returning = true;
        if (spot && this.pathTo(ch, spot).length > 0) {
          ch.path = this.pathTo(ch, spot);
          ch.moveProgress = 0;
          ch.state = CharacterState.WALK;
          ch.frame = 0;
          ch.frameTimer = 0;
        }
      }
    }
    if (person.contractor && this.tendContractor(person, dt)) return;
    // Not on the floor on show: it stands where it is, unseen, and holds no bench.
    if (!this.personOnFloor(person)) {
      this.releaseBench(person, false);
      // A break cut short stands where it is: it must not come back and finish a stale path to a tile nobody holds.
      if (this.staffRoutes.has(ch.id)) {
        this.dropStaffRoute(ch.id);
        this.stand(ch);
      }
      return;
    }
    // Home it wanders over the Lounge floor only; away it works at a station, else types where it stopped.
    const walkable = person.subId === null ? this.loungeWalkable : os.walkableTiles;
    const step = (): void =>
      updateCharacter(ch, dt, walkable, os.seats, os.tileMap, os.blockedTiles);
    if (person.subId !== null) {
      this.tendWorker(person, person.subId);
      this.stepWorker(person, step);
    } else if (!person.contractor && !person.returning)
      this.tendStaff(person, dt, this.enabled(), step);
    else step();
    if (person.bench !== null) this.watchSitting(person);
    // Home again: a poof where the trip ends.
    if (person.returning && ch.state !== CharacterState.WALK) {
      person.returning = false;
      if (this.personOnFloor(person)) this.poofAt(ch);
    }
  }

  // ── Contractors ──────────────────────────────────────────────────

  /**
   * A contractor's idle timer and departure, run before the off-floor return so the timer runs unseen too. Done for 120 s it walks to
   * the lift and despawns there; with nobody looking it is removed at once. True when the contractor is gone (the step ends).
   */
  private tendContractor(person: Person, dt: number): boolean {
    const ch = person.ch;
    const c = person.contractor!;
    if (person.subId !== null) {
      c.idle = 0;
      return false;
    }
    c.idle += dt;
    if (!c.leaving && c.idle < CONTRACTOR_IDLE_SEC) return false;
    if (!this.personOnFloor(person)) {
      this.releaseBench(person, false);
      this.people = this.people.filter((p) => p !== person);
      return true;
    }
    if (!c.leaving) {
      c.leaving = true;
      person.returning = false;
      const path = this.liftPath(ch);
      if (path === null) {
        this.despawnContractor(person);
        return true;
      }
      ch.isActive = false;
      ch.wanderTimer = 1e9;
      // Already at a lift: it stops here, whatever old path it was walking.
      if (path.length === 0) this.stand(ch);
      else {
        ch.path = path;
        ch.moveProgress = 0;
        ch.state = CharacterState.WALK;
        ch.frame = 0;
        ch.frameTimer = 0;
      }
    }
    if (ch.state !== CharacterState.WALK) {
      this.despawnContractor(person);
      return true;
    }
    return false;
  }

  private despawnContractor(person: Person): void {
    this.releaseBench(person, false);
    person.ch.path = [];
    person.ch.moveProgress = 0;
    startMatrixEffect(person.ch, 'despawn');
  }

  /** The path to the nearest lobby tile that can be reached ([] when already on one), or null when there is none. */
  private liftPath(ch: Character): Tile[] | null {
    const byDistance = [...this.lobby].sort(
      (a, b) =>
        Math.abs(a.col - ch.tileCol) +
        Math.abs(a.row - ch.tileRow) -
        (Math.abs(b.col - ch.tileCol) + Math.abs(b.row - ch.tileRow)),
    );
    for (const t of byDistance) {
      if (t.col === ch.tileCol && t.row === ch.tileRow) return [];
      const path = this.pathTo(ch, t);
      if (path.length > 0) return path;
    }
    return null;
  }

  /** A contractor of the floor for the type, out of a lift, when the floor has the type, a lift and room (never for a PR-run lead). */
  private hire(lead: Character, type: string, floorId: string | null): Person | null {
    if (floorId === null || this.lobby.length === 0 || lead.directoryName === PR_RUNS_ROOM)
      return null;
    const home = this.people.find(
      (p) =>
        !p.contractor && p.floor === floorId && p.slug === type && p.ch.matrixEffect !== 'despawn',
    );
    if (!home) return null;
    const here = this.people.filter((p) => p.contractor && p.floor === floorId);
    if (here.length >= CONTRACTOR_CAP) return null;
    const taken = new Set(here.filter((p) => p.slug === type).map((p) => p.contractor!.number));
    let number = 2;
    while (taken.has(number)) number++;
    const used = new Set(this.people.map((p) => p.ch.id));
    let id = CONTRACTOR_ID_BASE;
    while (used.has(id)) id--;
    const occupied = this.occupied(Number.NaN);
    const spot = this.lobby.find((t) => !occupied.has(key(t.col, t.row))) ?? this.lobby[0];
    // A look bounded by (type, number): a palette that moves with both, a hue turn only past the palettes.
    const palettes = Math.max(1, getLoadedCharacterCount());
    let h = 0;
    for (const c of type) h = (h * 31 + c.charCodeAt(0)) % 997;
    const ch = createCharacter(
      id,
      (h + number) % palettes,
      null,
      null,
      (Math.floor((number - 2) / palettes) % 6) * 60,
    );
    ch.isActive = false;
    ch.state = CharacterState.IDLE;
    ch.dir = Direction.DOWN;
    ch.tileCol = spot.col;
    ch.tileRow = spot.row;
    this.stand(ch);
    startMatrixEffect(ch, 'spawn');
    const person: Person = {
      slug: type,
      floor: floorId,
      room: null,
      name: `${home.name} #${number}`,
      ch,
      subId: null,
      returning: false,
      ...noStation(activityOf(type)),
      contractor: { number, idle: 0, leaving: false },
    };
    this.people.push(person);
    return person;
  }

  // ── Stations ─────────────────────────────────────────────────────

  /** Seat uids of the benches active workers sit on, for the PCs they face (the office turns those on). */
  activeBenchSeats(): Seat[] {
    const seats: Seat[] = [];
    for (const [uid, w] of this.borrowed) {
      const seat = this.os.seats.get(uid);
      if (seat && w.ch.isActive && w.ch.state === CharacterState.TYPE) seats.push(seat);
    }
    return seats;
  }

  /** Whether `ch` sits on a seat Aero lent it (the stock code leaves such a seat's `assigned` alone). */
  holdsBorrowed(ch: Character): boolean {
    return ch.seatId !== null && this.borrowed.get(ch.seatId)?.ch === ch;
  }

  /** Whether Aero routes stock subagents to stations now (its update and the Lounge are there): the stock seat logic gives them none. */
  routesSubagents(): boolean {
    return this.enabled() !== null;
  }

  /** The station groups a worker tries for this lead. */
  private chainFor(w: Worker, lead: Character): StationGroup[] {
    return chainOf(w.activity, lead.directoryName === PR_RUNS_ROOM);
  }

  /** The seat Aero lent `ch` is let go at once (a layout rebuild hands the stock code every seat afresh). */
  dropBorrowed(ch: Character): void {
    const w = this.subs.get(ch.id);
    if (w) this.releaseBench(w, false);
  }

  /** The PC a worker faces follows whether it is sitting at work: the office rebuilds its furniture when that changes. */
  private watchSitting(loose: Worker | Person): void {
    const w = fill(loose);
    const sitting = w.ch.state === CharacterState.TYPE && w.ch.isActive;
    if (sitting === w.sitting) return;
    w.sitting = sitting;
    this.os.refreshFurniture();
  }

  /** The stock subagent's record of work, made when it is first looked at. */
  private subWork(ch: Character): SubWork {
    let w = this.subs.get(ch.id);
    if (!w) {
      w = { ch, subId: ch.id, ...noStation(this.subActivity.get(ch.id) ?? 'type') };
      this.subs.set(ch.id, w);
    }
    return w;
  }

  /** Forgets the stock subagents that are gone or leaving (a removed one despawns where it sits), and frees what they held. */
  private sweepSubs(): void {
    for (const [id, w] of this.subs) {
      const ch = this.os.characters.get(id);
      if (ch && ch.matrixEffect !== 'despawn' && this.os.subagentMeta.has(id) && !ch.aeroHidden)
        continue;
      this.releaseBench(w, false);
      this.subs.delete(id);
    }
    for (const id of [...this.subActivity.keys()]) {
      if (!this.os.characters.has(id)) this.subActivity.delete(id);
    }
  }

  /** Lets go of the worker's station. `standUp`: it gets up and takes the nearest free tile; else it stays where it is (`stranded`). */
  private releaseBench(loose: Worker | Person, standUp: boolean): void {
    const w = fill(loose);
    if (w.bench === null && w.prop === null) return;
    const hadSeat = w.bench !== null;
    if (w.bench !== null && this.borrowed.get(w.bench) === w) this.borrowed.delete(w.bench);
    if (w.prop !== null && this.props.get(w.prop) === w) this.props.delete(w.prop);
    w.bench = null;
    w.prop = null;
    w.group = null;
    w.ch.seatId = null;
    w.ch.aeroStanding = false;
    w.sitting = false;
    if (standUp) this.standAside(w);
    else w.stranded = true;
    if (hadSeat) this.os.refreshFurniture();
  }

  /** The worker gets up where it is and walks to the nearest free tile (or just stands when there is none it can reach). */
  private standAside(w: Worker): void {
    const ch = w.ch;
    w.stranded = false;
    const spot = this.nearestFreeTile(ch);
    ch.state = CharacterState.IDLE;
    ch.frame = 0;
    ch.frameTimer = 0;
    ch.path = [];
    ch.moveProgress = 0;
    if (spot) {
      const path = this.pathTo(ch, spot);
      if (path.length > 0) {
        ch.path = path;
        ch.state = CharacterState.WALK;
      }
    }
  }

  /** The stock subagent a person stands in for, or the person's own character when it is the worker itself. */
  private mirror(w: Worker, from: Character): void {
    const ch = w.ch;
    ch.isActive = from.isActive;
    ch.bubbleType = from.bubbleType;
    ch.waitingAwaitingInput = from.waitingAwaitingInput;
    ch.bubbleTimer = from.bubbleTimer;
  }

  /**
   * Keeps a worker's station honest, once a tick: mirrors the stock subagent a person stands in for; gone when somebody was seated on
   * the seat, or (for a pod PC bench) the lead's pod changed; held while it waits for permission; given up for the water cooler after
   * it has not worked for a while; moved up to a better one once its hold is over; taken when it works and holds none.
   */
  private tendWorker(loose: Worker | Person, subId: number): void {
    const w = fill(loose);
    const os = this.os;
    const ch = w.ch;
    const from = os.characters.get(subId);
    if (from && from !== ch) this.mirror(w, from);
    // A type that arrives after the spawn (the hook's start can come ticks after the transcript's) makes it look again at once.
    const kind = this.subActivity.get(subId);
    const changed = kind !== undefined && kind !== w.activity;
    const huddled = this.inHuddle(w);
    if (kind !== undefined) w.activity = kind;
    if (changed) {
      w.noBench = null;
      w.heldAt = this.clock - HOLD_SEC;
    }
    ch.aeroReading = readsAt(w.activity);
    const meta = os.subagentMeta.get(subId);
    const lead = meta ? os.characters.get(meta.parentAgentId) : undefined;
    const holding = (): boolean => w.bench !== null || w.prop !== null;
    if (!lead || !lead.seatId) {
      // Nothing to sit beside: a worker that lost its station still gets up.
      if (!holding() && w.stranded) this.standAside(w);
      return;
    }
    const permission = ch.bubbleType === 'permission';
    const idle = !ch.isActive && !permission;
    if (
      changed &&
      !huddled &&
      holding() &&
      w.group !== null &&
      !this.chainFor(w, lead).includes(w.group)
    ) {
      this.releaseBench(w, false);
      w.stranded = false;
    }
    if (idle) w.idleAt ??= this.clock;
    else w.idleAt = null;
    if (w.bench !== null) {
      const seat = os.seats.get(w.bench);
      const zone = os.seatZone(lead.seatId);
      // A pod PC bench is the lead's pod's; a seat anywhere else is not zone-checked.
      if (
        !seat ||
        seat.assigned ||
        (w.group === 'pc' && zone !== null && os.seatZone(w.bench) !== zone)
      ) {
        this.releaseBench(w, true);
      }
    }
    // In a meeting it stays on its seat: the meeting's own rules end it (see `tendHuddle`).
    if (huddled && w.bench !== null) return;
    if (holding()) {
      const held = this.clock - w.heldAt >= HOLD_SEC;
      if (idle && held && w.idleAt !== null && this.clock - w.idleAt >= IDLE_RELEASE_SEC) {
        this.goToCooler(w, lead);
      } else if (!idle && !permission && held) {
        const chain = this.chainFor(w, lead);
        const better = chain.slice(0, Math.max(0, chain.indexOf(w.group ?? chain[0])));
        if (better.length > 0 && this.takeStation(w, lead, better)) w.stranded = false;
      }
      return;
    }
    if (idle) return;
    w.cooler = null;
    if (this.takeStation(w, lead, this.chainFor(w, lead))) w.stranded = false;
    // No station for a worker that was sitting on one it no longer holds: it may not stay on a tile it doesn't own.
    else if (w.stranded) this.standAside(w);
  }

  // ── Meetings ─────────────────────────────────────────────────────

  /** The meetings switch (the test hook): turning it off ends a meeting that is running, with no burst. */
  setMeetings(on: boolean): void {
    this.meetings = on;
    if (!on) this.endHuddle(false);
  }

  private inHuddle(w: Worker): boolean {
    const h = this.huddle;
    return h !== null && (h.workers[0] === w || h.workers[1] === w);
  }

  private seatTile(uid: string): Tile | null {
    const seat = this.os.seats.get(uid);
    return seat ? { col: seat.seatCol, row: seat.seatRow } : null;
  }

  /** Whether the huddle's worker sits on its huddle seat now (arrived, not walking). */
  private seatedAt(w: Worker, h: Huddle): boolean {
    const uid = h.seats[h.workers[0] === w ? 0 : 1];
    const at = this.seatTile(uid);
    return (
      at !== null &&
      w.bench === uid &&
      w.ch.tileCol === at.col &&
      w.ch.tileRow === at.row &&
      w.ch.state === CharacterState.TYPE
    );
  }

  private seatedInHuddle(w: Worker): boolean {
    return this.huddle !== null && this.inHuddle(w) && this.seatedAt(w, this.huddle);
  }

  /** Every subagent on the floor on show that a meeting could take, by subagent id: stock ones and the people standing in for one. */
  private siblings(): Map<number, { w: Worker; lead: Character }> {
    const out = new Map<number, { w: Worker; lead: Character }>();
    const add = (w: Worker, subId: number, shown: boolean): void => {
      const meta = this.os.subagentMeta.get(subId);
      const lead = meta ? this.os.characters.get(meta.parentAgentId) : undefined;
      if (!shown || !lead || w.ch.matrixEffect) return;
      out.set(subId, { w, lead });
    };
    for (const w of this.subs.values()) add(w, w.subId, !this.hides(w.ch) && !w.ch.aeroHidden);
    for (const p of this.people) {
      if (p.subId !== null) add(fill(p), p.subId, this.personOnFloor(p));
    }
    return out;
  }

  /** Whether the worker works at a station it holds and stands or sits at (not walking, not at the cooler, not waiting). */
  private workingAtStation(w: Worker): boolean {
    const ch = w.ch;
    const at = this.tileOf(w);
    return (
      ch.isActive &&
      ch.bubbleType !== 'permission' &&
      w.cooler === null &&
      (w.bench !== null || w.prop !== null) &&
      at !== null &&
      ch.state === CharacterState.TYPE &&
      ch.tileCol === at.col &&
      ch.tileRow === at.row
    );
  }

  /**
   * Once a tick, after the workers were tended: counts who has worked at a station, ends the meeting that must end (a worker gone, not
   * working, off its seat, or the walk took too long), seats count and the burst, and starts the next meeting when a pair is ready.
   */
  private tendHuddle(): void {
    if (!this.meetings || !this.book || !this.podsInForce() || !this.enabled()) {
      this.endHuddle(false);
      this.workingSince.clear();
      return;
    }
    const sibs = this.siblings();
    for (const id of [...this.met]) if (!this.os.subagentMeta.has(id)) this.met.delete(id);
    const working = new Set<number>();
    for (const [id, { w }] of sibs) {
      if (!this.inHuddle(w) && this.workingAtStation(w)) working.add(id);
    }
    trackWorking(this.workingSince, working, this.clock);

    const h = this.huddle;
    if (h) {
      let ends = this.clock - h.startedAt >= HUDDLE_WALK_SEC && h.seatedAt === null;
      for (let i = 0; i < 2 && !ends; i++) {
        const found = sibs.get(h.subs[i]);
        const w = h.workers[i];
        ends =
          !found ||
          found.w !== w ||
          w.bench !== h.seats[i] ||
          this.borrowed.get(h.seats[i]) !== w ||
          !w.ch.isActive ||
          w.ch.bubbleType === 'permission';
      }
      if (ends) {
        this.endHuddle(false);
        return;
      }
      if (h.seatedAt === null && h.workers.every((w) => this.seatedAt(w, h))) {
        h.seatedAt = this.clock;
        this.huddlesHeld++;
        const a = this.seatTile(h.seats[0])!;
        const b = this.seatTile(h.seats[1])!;
        this.startFx(
          'burst',
          ((a.col + b.col) / 2) * TILE_SIZE + TILE_SIZE / 2,
          ((a.row + b.row) / 2) * TILE_SIZE + TILE_SIZE / 2 + FX_BURST_DROP,
        );
      }
      if (h.seatedAt !== null && this.clock - h.seatedAt >= HUDDLE_SEC) this.endHuddle(true);
      return;
    }
    if (this.clock < this.huddleRetryAt) return;
    const ready: Working[] = [];
    for (const [id, since] of this.workingSince) {
      const found = sibs.get(id);
      if (found) ready.push({ id, lead: found.lead.id, since });
    }
    const pair = pickPair(ready, this.met, this.clock);
    if (pair && !this.startHuddle(sibs.get(pair[0])!.w, sibs.get(pair[1])!.w, pair)) {
      this.huddleRetryAt = this.clock + HUDDLE_RETRY_SEC;
    }
  }

  /** Sends the pair to two free meeting seats that face each other. False when there are none (or no walk to them). */
  private startHuddle(wa: Worker, wb: Worker, subs: [number, number]): boolean {
    const book = this.book!;
    const free = book.seats
      .filter((s) => s.group === 'meeting')
      .flatMap((s) => {
        const seat = this.os.seats.get(s.key);
        return seat && !seat.assigned && !this.borrowed.has(s.key)
          ? [{ uid: s.key, col: seat.seatCol, row: seat.seatRow, dir: seat.facingDir }]
          : [];
      });
    const taken = this.occupied(Number.NaN);
    const pairs = facingPairs(free).filter(
      ([x, y]) => !taken.has(key(x.col, x.row)) && !taken.has(key(y.col, y.row)),
    );
    let searches = 0;
    for (const [x, y] of pairs) {
      if (searches >= CANDIDATES_TRIED) break;
      const spots = [x, y];
      const paths: Tile[][] = [];
      let ok = true;
      for (const [i, w] of [wa, wb].entries()) {
        const s = spots[i];
        const at = w.ch.tileCol === s.col && w.ch.tileRow === s.row;
        searches++;
        const path = at ? [] : this.pathTo(w.ch, { col: s.col, row: s.row });
        if (!at && path.length === 0) {
          ok = false;
          break;
        }
        paths.push(path);
      }
      if (!ok) continue;
      for (const [i, w] of [wa, wb].entries()) {
        const s = spots[i];
        this.assignStation(w, {
          group: 'meeting',
          key: s.uid,
          seat: s.uid,
          col: s.col,
          row: s.row,
          dir: s.dir as Direction,
        });
        w.noBench = null;
        const ch = w.ch;
        if (paths[i].length > 0) {
          ch.path = paths[i];
          ch.moveProgress = 0;
          ch.state = CharacterState.WALK;
          ch.frame = 0;
          ch.frameTimer = 0;
        } else {
          this.stand(ch);
          this.pose(w);
        }
      }
      this.met.add(subs[0]);
      this.met.add(subs[1]);
      this.huddle = {
        subs,
        seats: [x.uid, y.uid],
        workers: [wa, wb],
        startedAt: this.clock,
        seatedAt: null,
        bubble:
          HUDDLE_BUBBLES[Math.floor(this.rng() * HUDDLE_BUBBLES.length) % HUDDLE_BUBBLES.length],
      };
      return true;
    }
    return false;
  }

  /**
   * The meeting is over: both seats are let go. After a full meeting each worker looks for a station at once; after an early end one
   * that still works does too, one waiting for permission stays where it is, and an idle one goes to its pod's water cooler (else
   * stands aside).
   */
  private endHuddle(full: boolean): void {
    const h = this.huddle;
    if (!h) return;
    this.huddle = null;
    for (let i = 0; i < 2; i++) {
      const w = h.workers[i];
      if (w.bench !== h.seats[i]) continue;
      const permission = w.ch.bubbleType === 'permission';
      const works = w.ch.isActive && !permission;
      w.noBench = null;
      if (full || works || permission) {
        // A full meeting or a worker still at work looks for a station at once; one waiting for permission stays where it is.
        this.releaseBench(w, false);
        continue;
      }
      // Idle: as after its idle wait at a station, the pod's water cooler, else it stands aside.
      const meta = this.os.subagentMeta.get(h.subs[i]);
      const lead = meta ? this.os.characters.get(meta.parentAgentId) : undefined;
      if (lead) this.goToCooler(w, lead);
      else this.releaseBench(w, true);
    }
  }

  /** What decides whether a station search can find something new: the seats taken, the stations borrowed, the routes, the lead's seat. */
  private benchSignature(leadSeatId: string): string {
    let h = this.borrowed.size + this.props.size * 1000;
    let i = 0;
    for (const seat of this.os.seats.values()) {
      i++;
      if (seat.assigned) h = (h * 31 + i) | 0;
    }
    return `${leadSeatId}|${h}|${this.occupancy}|${this.os.seats.size}`;
  }

  /** The stations of `group` the lead's worker may take, nearest the lead's seat first. */
  private candidates(group: StationGroup, lead: Character): Station[] {
    const os = this.os;
    const book = this.book;
    const anchor = lead.seatId ? os.seats.get(lead.seatId) : undefined;
    if (!book || !lead.seatId || !anchor) return [];
    const zone = os.seatZone(lead.seatId);
    const seatFree = (s: Station): boolean => {
      const seat = os.seats.get(s.key);
      return seat !== undefined && !seat.assigned && !this.borrowed.has(s.key);
    };
    let list: Station[];
    switch (group) {
      case 'pc':
        // The wooden benches of the lead's pod that face a PC, nearest first.
        return os.benchSeatsFor(lead.seatId, this.borrowed).flatMap((uid) => {
          const seat = os.seats.get(uid);
          return seat
            ? [
                {
                  group,
                  key: uid,
                  seat: uid,
                  col: seat.seatCol,
                  row: seat.seatRow,
                  dir: seat.facingDir,
                },
              ]
            : [];
        });
      case 'whiteboard':
        list = book.boards.filter((b) => b.zone === zone);
        break;
      case 'shelf':
        list = book.shelves;
        break;
      case 'cooler':
        list = book.coolers.filter((b) => b.zone === zone);
        break;
      default:
        list = book.seats.filter((s) => s.group === group);
    }
    return list
      .filter((s) => (s.seat === null ? !this.props.has(s.key) : seatFree(s)))
      .map((s) => {
        const seat = s.seat === null ? undefined : os.seats.get(s.seat);
        const at = seat ? { col: seat.seatCol, row: seat.seatRow } : s;
        return { s, d: Math.abs(at.col - anchor.seatCol) + Math.abs(at.row - anchor.seatRow) };
      })
      .sort((a, b) => a.d - b.d || (a.s.key < b.s.key ? -1 : 1))
      .map(({ s }) => (s.seat !== null ? { ...s, dir: os.seats.get(s.seat)!.facingDir } : s));
  }

  /**
   * Takes the first free station of `groups`, in order, nearest first, that the worker can reach (at most `CANDIDATES_TRIED` path
   * searches; none again until the world changes, see `benchSignature`). It walks there, or, with `snap`, is put there at once. A
   * station it already holds is let go once the new one is chosen. False when there is none.
   */
  private takeStation(
    loose: Worker | Person,
    lead: Character,
    groups: StationGroup[],
    snap = false,
  ): boolean {
    const w = fill(loose);
    const ch = w.ch;
    if (!lead.seatId) return false;
    const signature = `${this.benchSignature(lead.seatId)}|${groups.join()}|${w.group ?? ''}`;
    if (w.noBench === signature) return false;
    const taken = this.occupied(ch.id);
    // A seat a lead is carrying a handoff to is not lent out meanwhile.
    const handoffStops = new Set<string>();
    for (const route of this.routes.values()) {
      if (route.hand) handoffStops.add(key(route.target.col, route.target.row));
    }
    let searches = 0;
    for (const group of groups) {
      for (const st of this.candidates(group, lead)) {
        if (st.seat === null && taken.has(st.key)) continue;
        if (handoffStops.has(key(st.col, st.row))) continue;
        const at = ch.tileCol === st.col && ch.tileRow === st.row;
        let path: Tile[] = [];
        if (!at && !snap) {
          if (searches >= CANDIDATES_TRIED) {
            w.noBench = signature;
            return false;
          }
          searches++;
          path = this.pathTo(ch, { col: st.col, row: st.row });
          if (path.length === 0) continue;
        }
        this.assignStation(w, st);
        if (at || snap) {
          ch.tileCol = st.col;
          ch.tileRow = st.row;
          this.stand(ch);
          this.pose(w);
        } else {
          ch.path = path;
          ch.moveProgress = 0;
          ch.state = CharacterState.WALK;
          ch.frame = 0;
          ch.frameTimer = 0;
        }
        w.noBench = null;
        return true;
      }
    }
    w.noBench = signature;
    return false;
  }

  /** The worker holds `st`: the one it held before is let go (where it is), the new one is borrowed. */
  private assignStation(w: Worker, st: Station): void {
    const ch = w.ch;
    const wasSeat = w.bench !== null;
    // A seat the stock code gave a stock subagent (a layout rebuild hands every character one) is given back.
    if (ch.isSubagent && w.bench === null && w.prop === null && ch.seatId !== null) {
      const own = this.os.seats.get(ch.seatId);
      if (own && !this.borrowed.has(ch.seatId)) own.assigned = false;
    }
    if (w.bench !== null && this.borrowed.get(w.bench) === w) this.borrowed.delete(w.bench);
    if (w.prop !== null && this.props.get(w.prop) === w) this.props.delete(w.prop);
    w.bench = st.seat;
    w.prop = st.seat === null ? st.key : null;
    w.group = st.group;
    w.faces = st.dir;
    w.heldAt = this.clock;
    w.cooler = null;
    w.sitting = false;
    ch.seatId = st.seat;
    ch.aeroStanding = false;
    if (st.seat !== null) this.borrowed.set(st.seat, w);
    else this.props.set(st.key, w);
    if (st.seat !== null || wasSeat) this.os.refreshFurniture();
  }

  /** At its station: it types or reads there, facing it. A prop is stood at, a seat sat on; a waiting or idle worker is still. */
  private pose(w: Worker): void {
    const ch = w.ch;
    const seat = w.bench === null ? undefined : this.os.seats.get(w.bench);
    const dir = seat ? seat.facingDir : w.faces;
    if (ch.state !== CharacterState.TYPE) {
      ch.frame = 0;
      ch.frameTimer = 0;
    }
    ch.state = CharacterState.TYPE;
    ch.dir = dir;
    w.faces = dir;
    ch.path = [];
    ch.moveProgress = 0;
    ch.aeroStanding = w.prop !== null;
    ch.x = ch.tileCol * TILE_SIZE + TILE_SIZE / 2;
    ch.y = ch.tileRow * TILE_SIZE + TILE_SIZE / 2;
    if (!ch.isActive || ch.bubbleType === 'permission') ch.frame = 0;
  }

  /** The tile a worker walks to or stands at now: its station, or the water cooler it was sent to. */
  private tileOf(w: Worker): Tile | null {
    if (w.cooler) return w.cooler;
    if (w.bench !== null) {
      const seat = this.os.seats.get(w.bench);
      return seat ? { col: seat.seatCol, row: seat.seatRow } : null;
    }
    if (w.prop !== null) {
      const [col, row] = w.prop.split(',').map(Number);
      return { col, row };
    }
    return null;
  }

  /**
   * The worker's step. Without a station it is the stock one. With one it walks (the stock step), then stands or sits there facing it,
   * still while it waits or is idle, animated by the stock step while it works.
   */
  private stepWorker(loose: Worker | Person, step: () => void): void {
    const w = fill(loose);
    const ch = w.ch;
    const at = this.tileOf(w);
    if (at === null) {
      step();
      // Working with no station to be had: it stands there, facing down, not sunk into the floor as a sitter is.
      if (ch.isActive && ch.state === CharacterState.TYPE && ch.seatId === null) {
        ch.aeroStanding = true;
        ch.dir = Direction.DOWN;
      }
      return;
    }
    if (ch.state === CharacterState.WALK) {
      step();
      if (ch.state === CharacterState.WALK) return;
    }
    if (ch.tileCol !== at.col || ch.tileRow !== at.row) {
      // The walk ended short of the station: once more, else it gives the station up.
      if (!this.walkTo(ch, at)) {
        if (w.cooler) w.cooler = null;
        else this.releaseBench(w, true);
      }
      return;
    }
    if (w.cooler) {
      ch.state = CharacterState.IDLE;
      ch.dir = Direction.UP;
      ch.frame = 0;
      ch.path = [];
      ch.x = at.col * TILE_SIZE + TILE_SIZE / 2;
      ch.y = at.row * TILE_SIZE + TILE_SIZE / 2;
      return;
    }
    this.pose(w);
    if (ch.isActive && ch.bubbleType !== 'permission') step();
  }

  /** The worker has not worked for a while: it lets go of its station and walks to the lead's pod's water cooler (else it just gets up). */
  private goToCooler(w: Worker, lead: Character): void {
    const ch = w.ch;
    const coolers = this.candidates('cooler', lead);
    const taken = this.occupied(ch.id);
    const spot = coolers.find((c) => !taken.has(key(c.col, c.row)));
    // Every cooler tile of the pod is taken or reserved: it stays on its station and asks again.
    if (!spot && coolers.length > 0) return;
    this.releaseBench(w, false);
    w.stranded = false;
    if (spot) {
      const at = ch.tileCol === spot.col && ch.tileRow === spot.row;
      const path = at ? [] : this.pathTo(ch, spot);
      if (at || path.length > 0) {
        w.cooler = { col: spot.col, row: spot.row };
        if (!at) {
          ch.path = path;
          ch.moveProgress = 0;
          ch.state = CharacterState.WALK;
          ch.frame = 0;
          ch.frameTimer = 0;
        }
        return;
      }
    }
    this.standAside(w);
  }

  private nearestFreeTile(
    from: { tileCol: number; tileRow: number },
    except = Number.NaN,
  ): Tile | null {
    const taken = this.occupied(except);
    let best: Tile | null = null;
    let bestD = Infinity;
    for (const t of this.os.walkableTiles) {
      if (taken.has(key(t.col, t.row))) continue;
      const d = Math.abs(t.col - from.tileCol) + Math.abs(t.row - from.tileRow);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  /** The people at home stand on the Lounge floor: after a new layout, one that isn't on it moves to a free tile of it. */
  private rehomePeople(): void {
    const onFloor = new Set(this.loungeWalkable.map((t) => key(t.col, t.row)));
    for (const person of this.people) {
      const ch = person.ch;
      if (person.subId !== null || ch.matrixEffect === 'despawn') continue;
      // A contractor on its way out when the layout is rebuilt has nowhere it knew to go: it is gone.
      if (person.contractor?.leaving) {
        this.people = this.people.filter((p) => p !== person);
        continue;
      }
      // At home on the new layout: whatever it was walking to (the old Lounge, a trip back) ends here, on the Lounge floor.
      if (!onFloor.has(key(ch.tileCol, ch.tileRow))) {
        const spot = this.freeLoungeTile(person, person);
        if (spot) {
          ch.tileCol = spot.col;
          ch.tileRow = spot.row;
        }
      }
      person.returning = false;
      this.stand(ch);
      ch.wanderTimer = 1;
    }
  }

  /**
   * A SubagentStart named `status`'s type. A lead on the floor on show: the subagent is matched at once (see `match`), and true
   * is returned when a configured character took its place. A lead of another floor: the subagent is queued with nobody assigned
   * (once: the tool-start message repeats, and `match` ignores a subagent it already holds), matched when its lead's floor is shown; false.
   */
  subagentStarted(parentId: number, parentToolId: string, status: unknown): boolean {
    const type = agentTypeFromStatus(status);
    if (type === null) return false;
    const lead = this.os.characters.get(parentId);
    if (!lead) return false;
    const subId = this.os.getSubagentId(parentId, parentToolId);
    if (subId !== null) this.subActivity.set(subId, activityOf(type));
    // Not yet matchable: its lead's floor is off, or the first update (and with it the people) hasn't come.
    if (!this.onFloor(lead) || !this.peopleReady()) {
      if (this.queued.length >= MAX_QUEUED) this.queued.shift();
      this.queued.push({ parentId, toolId: parentToolId, type });
      return false;
    }
    return this.match(lead, parentToolId, type);
  }

  /** Whether the update has come and its people are made (a subagent that starts before is queued). */
  private peopleReady(): boolean {
    return getAeroUpdate() !== null && this.people.length > 0;
  }

  /** Matches the queued subagents whose lead's floor is shown now; drops those that ended or whose lead left. */
  private matchQueued(): void {
    if (this.queued.length === 0) return;
    const keep: QueuedSubagent[] = [];
    for (const q of this.queued) {
      const lead = this.os.characters.get(q.parentId);
      const subId = this.os.getSubagentId(q.parentId, q.toolId);
      const sub = subId === null ? undefined : this.os.characters.get(subId);
      if (!lead || !sub || sub.matrixEffect === 'despawn' || lead.matrixEffect === 'despawn')
        continue;
      if (this.onFloor(lead) && this.peopleReady()) this.match(lead, q.toolId, q.type);
      else keep.push(q);
    }
    this.queued = keep;
  }

  /**
   * A free person of the floor on show and the type, else a free person of the lead's room (the Rooms style), else a free owner
   * person of the type whose roster the floor lacks, else nobody (the stock subagent stays). One that is still spawning matches
   * too; one that is despawning does not. (Two subagents of one type at once: the second is a contractor of the floor, hired or reused, else stock.)
   */
  private match(lead: Character, parentToolId: string, type: string): boolean {
    const floorId = getAeroUpdate()?.floor?.id ?? null;
    const subId = this.os.getSubagentId(lead.id, parentToolId);
    const sub = subId === null ? undefined : this.os.characters.get(subId);
    if (subId === null || !sub) return false;
    // Already matched (this runs on every subagent tool start): never a second person, never a second hire.
    if (sub.aeroHidden || this.people.some((p) => p.subId === subId)) return true;
    // A person whose stand-in has ended but which the tick hasn't sent home yet is free too.
    const free = (p: Person): boolean =>
      p.slug === type &&
      p.ch.matrixEffect !== 'despawn' &&
      (p.subId === null || !this.os.subagentMeta.has(p.subId));
    const own = (p: Person): boolean => !p.contractor && free(p);
    let hired = false;
    let person =
      this.people.find((p) => own(p) && p.floor !== null && p.floor === floorId) ??
      this.people.find((p) => own(p) && p.room !== null && p.room === lead.directoryName) ??
      this.people.find(
        (p) => own(p) && p.floor === null && p.room === null && this.homeOnFloor(p),
      ) ??
      this.people.find(
        (p) =>
          p.contractor !== undefined &&
          lead.directoryName !== PR_RUNS_ROOM &&
          free(p) &&
          p.floor === floorId &&
          p.slug === type,
      ) ??
      null;
    if (!person) {
      person = this.hire(lead, type, floorId);
      hired = person !== null;
    }
    if (!person) return false;
    if (person.contractor) {
      person.contractor.leaving = false;
      person.contractor.idle = 0;
    }
    // A break ends here: the person works for the subagent now.
    this.dropStaffRoute(person.ch.id);
    this.pickAt.delete(person.ch.id);
    // Its last stand-in ended before the tick sent it home: it keeps the tile it stands on, and lets go of the bench.
    if (person.subId !== null) this.releaseBench(person, false);
    sub.aeroHidden = true;
    // Its own record of work, if the stock subagent had one, is let go: the person works for it now.
    const held = this.subs.get(subId);
    if (held) {
      this.releaseBench(held, false);
      this.subs.delete(subId);
    }
    person.subId = subId;
    person.activity = activityOf(type);
    person.returning = false;
    person.stranded = false;
    const ch = person.ch;
    // A stand-in for a subagent of another floor is hidden with it: no poof.
    if (!hired && this.personOnFloor(person)) this.poofAt(ch);
    ch.isActive = true;
    // A free station (a PC bench of the lead's pod, else the next tier of its activity), else the free tile nearest its desk (the lead's
    // seat, not wherever the lead stands now: a lead resting in the Lounge is not where the work is).
    person.noBench = null;
    if (this.takeStation(person, lead, this.chainFor(fill(person), lead))) return true;
    // No bench: it stops what it was doing (a trip home, a walk to the lift) before it is routed, and stands if it cannot be.
    this.stand(ch);
    const taken = this.occupied(Number.NaN);
    const leadSeat = lead.seatId ? this.os.seats.get(lead.seatId) : undefined;
    const anchor: Tile = leadSeat
      ? { col: leadSeat.seatCol, row: leadSeat.seatRow }
      : { col: lead.tileCol, row: lead.tileRow };
    let best: Tile | null = null;
    let bestD = Infinity;
    for (const t of this.os.walkableTiles) {
      if (taken.has(key(t.col, t.row))) continue;
      const d = Math.abs(t.col - anchor.col) + Math.abs(t.row - anchor.row);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    if (best) {
      const path = this.pathTo(ch, best);
      if (path.length > 0) {
        ch.path = path;
        ch.moveProgress = 0;
        ch.state = CharacterState.WALK;
        ch.frame = 0;
        ch.frameTimer = 0;
      }
    }
    return true;
  }

  // ── Where OfficeState joins them in ─────────────────────────────

  /** The characters the renderer draws: `list` less the hidden stock subagents, plus the configured ones. */
  characters(list: Character[]): Character[] {
    this.holdFrontDesk();
    const shown = list.filter((ch) => !this.hides(ch));
    for (const person of this.people) if (this.personOnFloor(person)) shown.push(person.ch);
    for (const npc of this.npcs) shown.push(npc.ch);
    return shown;
  }

  /** The count of live subagents of each lead, for the badges. */
  badgeCounts(): Map<number, number> {
    const counts = new Map<number, number>();
    for (const meta of this.os.subagentMeta.values()) {
      counts.set(meta.parentAgentId, (counts.get(meta.parentAgentId) ?? 0) + 1);
    }
    return counts;
  }

  /** The live pod data of the last accepted update, or null (an update without pods, or none). */
  currentPods(): AeroPods | null {
    return getAeroUpdate()?.pods ?? null;
  }

  /** The area labels whose text the pods draw, so the stock area labels leave them out. Cached per pods object. */
  podLabelKeys(): ReadonlySet<string> | undefined {
    const pods = getAeroUpdate()?.pods;
    return pods ? podLabelSet(pods) : undefined;
  }

  /** The last accepted update. */
  currentUpdate(): AeroUpdate | null {
    return getAeroUpdate();
  }

  /** Which wall object a click at world point (x, y) lands on, when the office has the Lounge and Aero's update. */
  wallHitAt(x: number, y: number): WallHit | null {
    this.refresh();
    return this.enabled() ? wallHit(this.lounge, x, y) : null;
  }

  /** The first name each character was given (by id), kept until it leaves: names are made once, not remade as the set changes. */
  private nameBook = new Map<number, { first: string; parity: number }>();
  private labelCache: {
    stamp: [number, number, number, number, AeroUpdate | null, number];
    labels: NameLabel[];
    byId: Map<number, NameLabel>;
  } | null = null;

  /** The labels by character id, from the same pass as `labels()`: one map for a whole frame. */
  labelMap(): ReadonlyMap<number, NameLabel> {
    this.labels();
    return this.labelCache!.byId;
  }

  /**
   * The name over every character on show. Keys: a person by `floor/room/slug` (a contractor's adds `#number`), the front desk by
   * role, a lead by its folder and its rank by id among the leads of that folder, a teammate by its lead's key and its rank, and a
   * stock subagent likewise by its parent's; one whose parent is not on show has its own id in the key. Nothing from a transcript
   * (`agentName`, a subagent's type) is used.
   *
   * A first name is given once (`assignFirstNames`, from the salted key, never one in use on show) and kept by character id until
   * the character leaves, whatever the keys and the others do; it is made again only when its palette's parity changes. The result
   * is kept until something that can change it does (a tick, the characters or people counted, the update, the off-floor set), so
   * a frame and a tool overlay render ask once; `force` always rebuilds (the snapshot).
   */
  labels(force = false): NameLabel[] {
    const update = getAeroUpdate();
    const stamp: [number, number, number, number, AeroUpdate | null, number] = [
      this.clock,
      this.os.characters.size,
      this.people.length,
      this.npcs.length,
      update,
      this.offFloor.size,
    ];
    const cached = this.labelCache;
    if (!force && cached && cached.stamp.every((v, i) => v === stamp[i])) return cached.labels;
    type Entry = Omit<NameLabel, 'first'>;
    const entries: Entry[] = [];
    for (const p of this.people) {
      if (!this.personOnFloor(p)) continue;
      const base = personId(p.floor, p.room, p.slug);
      const role = roleFromSlug(p.slug);
      entries.push({
        id: p.ch.id,
        kind: p.contractor ? 'contractor' : 'person',
        key: p.contractor ? `${base}#${p.contractor.number}` : base,
        palette: p.ch.palette,
        role: p.contractor ? `${role} #${p.contractor.number}` : role,
      });
    }
    for (const n of this.npcs) {
      entries.push({
        id: n.ch.id,
        kind: 'desk',
        key: `desk/${n.role}`,
        palette: n.ch.palette,
        role: DESK_LABEL_ROLES[n.role],
      });
    }
    const shown: Character[] = [];
    for (const c of this.os.characters.values()) {
      if (!this.hides(c) && !c.isGreeter && c.matrixEffect !== 'despawn') shown.push(c);
    }
    // Each group is ranked once: leads by folder, teammates by lead, subagents by parent.
    const groups = (list: Character[], by: (c: Character) => string, descending: boolean) => {
      const map = new Map<string, Character[]>();
      for (const c of list) {
        const k = by(c);
        const g = map.get(k);
        if (g) g.push(c);
        else map.set(k, [c]);
      }
      const rank = new Map<number, number>();
      for (const g of map.values()) {
        g.sort((a, b) => (descending ? b.id - a.id : a.id - b.id));
        g.forEach((c, i) => rank.set(c.id, i));
      }
      return rank;
    };
    const leads = shown.filter((c) => !c.isSubagent && c.leadAgentId === undefined);
    const mates = shown.filter((c) => !c.isSubagent && c.leadAgentId !== undefined);
    const subs = shown.filter((c) => c.isSubagent);
    const folderOf = (c: Character): string => c.directoryName ?? '';
    const leadRank = groups(leads, folderOf, false);
    const mateRank = groups(mates, (c) => String(c.leadAgentId), false);
    const subRank = groups(subs, (c) => String(c.parentAgentId), true);
    const keyOf = new Map<number, string>();
    for (const ch of leads) {
      const key = `lead/${folderOf(ch)}/${leadRank.get(ch.id)}`;
      keyOf.set(ch.id, key);
      entries.push({
        id: ch.id,
        kind: 'lead',
        key,
        palette: ch.palette,
        role: folderOf(ch) === PR_RUNS_ROOM ? 'PR' : 'Lead',
      });
    }
    // A character whose parent is not on show has its own id in the key, so two of them never share one.
    const parentKey = (ch: Character, parent: number | null | undefined): string =>
      (parent === null || parent === undefined ? undefined : keyOf.get(parent)) ??
      `orphan/${ch.id}`;
    for (const ch of mates) {
      const key = `${parentKey(ch, ch.leadAgentId)}/mate/${mateRank.get(ch.id)}`;
      keyOf.set(ch.id, key);
      entries.push({ id: ch.id, kind: 'teammate', key, palette: ch.palette, role: 'Teammate' });
    }
    for (const ch of subs) {
      const key = `${parentKey(ch, ch.parentAgentId)}/sub/${subRank.get(ch.id)}`;
      entries.push({ id: ch.id, kind: 'subagent', key, palette: ch.palette, role: 'Subagent' });
    }
    // The book forgets those that left (anywhere, not only off this floor), and keeps the rest by id.
    const alive = new Set<number>();
    for (const p of this.people) alive.add(p.ch.id);
    for (const n of this.npcs) alive.add(n.ch.id);
    for (const id of this.os.characters.keys()) alive.add(id);
    for (const id of this.nameBook.keys()) if (!alive.has(id)) this.nameBook.delete(id);
    const fresh: Entry[] = [];
    const inUse = new Set<string>();
    for (const e of entries) {
      const kept = this.nameBook.get(e.id);
      if (kept && kept.parity === e.palette % 2) inUse.add(kept.first);
      else fresh.push(e);
    }
    if (fresh.length > 0) {
      const firsts = assignFirstNames(fresh, inUse);
      for (const e of fresh) {
        this.nameBook.set(e.id, { first: firsts.get(e.key) ?? '', parity: e.palette % 2 });
      }
    }
    const labels = entries.map((e) => ({ ...e, first: this.nameBook.get(e.id)?.first ?? '' }));
    this.labelCache = { stamp, labels, byId: new Map(labels.map((l) => [l.id, l] as const)) };
    return labels;
  }

  /** The tile a worker stands at before a prop, or null (it sits, or holds no station). */
  private standTile(loose: Worker | Person): Tile | null {
    const w = fill(loose);
    if (w.prop === null) return null;
    const [col, row] = w.prop.split(',').map(Number);
    return { col, row };
  }

  /**
   * The bubbles over workers, for the canvas: the activity of a worker at its station (from the fixed table only), and the dots over a
   * person whose subagent waits for permission (the stock subagent's own dots are the tool overlay's).
   */
  workBubbles(): Array<{ ch: Character; text: string }> {
    const out: Array<{ ch: Character; text: string }> = [];
    const add = (w: Worker, person: boolean): void => {
      const ch = w.ch;
      if (ch.matrixEffect) return;
      if (ch.bubbleType === 'permission') {
        if (person) out.push({ ch, text: PERMISSION_BUBBLE });
        return;
      }
      const at = w.bench !== null || w.prop !== null;
      if (ch.bubbleType !== null || !ch.isActive || !at || ch.state !== CharacterState.TYPE) return;
      out.push({
        ch,
        text: this.seatedInHuddle(w) ? this.huddle!.bubble : ACTIVITY_BUBBLE[w.activity],
      });
    };
    for (const p of this.people) {
      if (p.subId !== null && this.personOnFloor(p)) add(fill(p), true);
    }
    for (const w of this.subs.values()) {
      if (!this.hides(w.ch)) add(w, false);
    }
    return out;
  }

  /** What the `getAero` test hook shows. */
  snapshot(): AeroSnapshot {
    this.refresh();
    this.holdFrontDesk();
    const update = getAeroUpdate();
    const worstWalkers = Math.max(this.worstWalkers, this.activeHandoffs());
    const protonStray = [...this.strayTiles];
    const protonTiles = [...this.protonTiles];
    return {
      update,
      clock: this.clock,
      worstWalkers,
      protonStray,
      protonTiles,
      care: {
        food: this.care.bowls.find((b) => b.kind === 'eat')?.bowl ?? null,
        water: this.care.bowls.find((b) => b.kind === 'drink')?.bowl ?? null,
        litter: this.care.litter,
        ball: this.ball,
      },
      lounge: this.lounge
        ? {
            floor: this.lounge.floor.length,
            seats: [...this.lounge.seats],
            table: this.lounge.table.map((t) => ({ ...t })),
            whiteboard: this.lounge.whiteboard
              ? { col: this.lounge.whiteboard.col, row: this.lounge.whiteboard.row }
              : null,
            clock: this.lounge.clock
              ? { col: this.lounge.clock.col, row: this.lounge.clock.row }
              : null,
          }
        : null,
      routes: [...this.routes].map(([id, r]) => ({
        id,
        mode: r.mode,
        col: r.target.col,
        row: r.target.row,
        seatUid: r.seatUid,
        arrived: r.arrived,
        bubble: this.bubbleFor(id),
        kind: kindOf(r),
      })),
      people: this.people.map((p) => ({
        slug: p.slug,
        floor: p.floor,
        room: p.room,
        name: p.name,
        id: p.ch.id,
        col: p.ch.tileCol,
        row: p.ch.tileRow,
        state: p.ch.state,
        shown: this.personOnFloor(p),
        away: p.subId !== null,
        bench: p.bench,
        stand: this.standTile(p),
        dir: p.ch.dir,
        activity: p.subId !== null ? (p.activity ?? null) : null,
        kind: p.contractor ? ('contractor' as const) : ('person' as const),
        number: p.contractor?.number ?? 0,
        idle: Math.floor(p.contractor?.idle ?? 0),
        leaving: p.contractor?.leaving ?? false,
        routine: this.staffRoutes.has(p.ch.id) ? this.viewOf(this.staffRoutes.get(p.ch.id)!) : null,
      })),
      lobby: this.lobby.map((t) => ({ ...t })),
      benches: [...this.borrowed.keys()],
      pcsOn: this.os.poweredFurniture(),
      leads: [...this.os.characters.values()]
        .filter((c) => !c.isSubagent)
        .map((c) => ({
          id: c.id,
          col: c.tileCol,
          row: c.tileRow,
          state: c.state,
          active: c.isActive,
          directoryName: c.directoryName ?? null,
          shown: !this.hides(c),
          dir: c.dir,
          seat: c.seatId ?? null,
          routine: this.routes.has(c.id) ? this.viewOf(this.routes.get(c.id)!) : null,
        })),
      smokers: this.smokerCount(),
      subagents: [...this.os.characters.values()]
        .filter((c) => c.isSubagent)
        .map((c) => {
          const w = this.subs.get(c.id);
          return {
            id: c.id,
            parent: this.os.subagentMeta.get(c.id)?.parentAgentId ?? null,
            col: c.tileCol,
            row: c.tileRow,
            state: c.state,
            dir: c.dir,
            hidden: c.aeroHidden === true,
            seat: w?.bench ?? null,
            stand: w ? this.standTile(w) : null,
            activity: w?.activity ?? this.subActivity.get(c.id) ?? 'type',
            station: w !== undefined && (w.bench !== null || w.prop !== null),
            cooler: w?.cooler !== null && w?.cooler !== undefined,
          };
        }),
      hidden: [...this.os.characters.values()].filter((c) => c.aeroHidden).map((c) => c.id),
      fxStarted: { ...this.fx.started },
      tube: this.book?.tube
        ? {
            col: this.book.tube.col,
            row: this.book.tube.row,
            queue: this.book.tube.queue.map((t) => ({ ...t })),
          }
        : null,
      tubeSent: this.tubesPosted,
      tubePosts: this.tubePosts.map((p) => ({ ...p })),
      handoffsDelivered: this.handoffs.delivered,
      handoffDeliveries: this.handoffs.deliveries.map((d) => ({ ...d })),
      activeHandoffs: this.activeHandoffs(),
      queuedHandoffs: this.handoffs.waitingCount,
      deskCapsules: this.deskCapsules(),
      meetingsOn: this.meetings,
      huddle: this.huddle
        ? {
            subs: [...this.huddle.subs],
            seats: [...this.huddle.seats],
            seated: this.huddle.workers.filter((w) => this.seatedAt(w, this.huddle!)).length,
            left: Math.max(
              0,
              Math.round(
                (HUDDLE_SEC -
                  (this.huddle.seatedAt === null ? 0 : this.clock - this.huddle.seatedAt)) *
                  10,
              ) / 10,
            ),
          }
        : null,
      huddlesHeld: this.huddlesHeld,
      badges: Object.fromEntries(this.badgeCounts()),
      npcs: this.npcs.map((n) => ({
        role: n.role,
        seat: n.seatUid,
        id: n.ch.id,
        col: n.ch.tileCol,
        row: n.ch.tileRow,
        dir: n.ch.dir,
        greeting: this.greetingFor(n),
      })),
      greetings: { ...this.greetings },
      labels: this.labels(true).map((l) => ({ ...l })),
      proton:
        this.proton && this.protonOn(update)
          ? {
              col: this.proton.col,
              row: this.proton.row,
              mode: this.proton.mode,
              moves: this.proton.moves,
              seat: this.proton.seat,
              spot: this.proton.spot,
            }
          : null,
    };
  }
}

export interface AeroSnapshot {
  update: AeroUpdate | null;
  /** The tick clock in seconds (`+= dt` once a sub-step): what every schedule of the page counts on. */
  clock: number;
  /** The most handoff walkers at once on any tick since the last `resetLatches`. */
  worstWalkers: number;
  /** The tiles ("col,row") Proton stood on outside her walk area and seats, on any tick since the last `resetLatches`. */
  protonStray: string[];
  /** Her care corner: the food and water bowls, the litter box and the ball (each null when the layout has no room for it). */
  care: {
    food: Tile | null;
    water: Tile | null;
    litter: Tile | null;
    ball: Tile | null;
  };
  /** Every tile ("col,row") she stood on on any tick since the last `resetLatches` (at most 256 distinct). */
  protonTiles: string[];
  lounge: {
    floor: number;
    seats: string[];
    table: Tile[];
    whiteboard: { col: number; row: number } | null;
    clock: { col: number; row: number } | null;
  } | null;
  routes: Array<{
    id: number;
    mode: RouteMode;
    col: number;
    row: number;
    seatUid: string | null;
    arrived: boolean;
    bubble: string | null;
    kind: RouteKind;
  }>;
  /** How many are out smoking on the floor on show (never more than 2). */
  smokers: number;
  people: Array<{
    slug: string;
    floor: string | null;
    room: string | null;
    name: string;
    id: number;
    col: number;
    row: number;
    state: string;
    /** Drawn: on the floor on show (`personOnFloor`). */
    shown: boolean;
    away: boolean;
    /** The seat it works on, or null. */
    bench: string | null;
    /** The tile it stands at before a prop (a bookshelf, the whiteboard), or null. */
    stand: Tile | null;
    dir: number;
    /** What it does, while it is away for a subagent; else null. */
    activity: Activity | null;
    kind: 'person' | 'contractor';
    /** A contractor's number (its name's `#N`), 0 for a person. */
    number: number;
    /** A contractor's whole seconds without work. */
    idle: number;
    leaving: boolean;
    /** The break an idle person is on (kind, phase, target), or null. */
    routine: RoutineView | null;
  }>;
  /** The tiles in front of the lifts. */
  lobby: Tile[];
  /** The pod benches people work on (borrowed, never assigned). */
  benches: string[];
  /** The uids of the furniture that is on because somebody sits at it (leads and people on benches). */
  pcsOn: string[];
  /** Every lead (not a subagent): where it is and whether it works. */
  leads: Array<{
    id: number;
    col: number;
    row: number;
    state: string;
    active: boolean;
    directoryName: string | null;
    /** Drawn: not a hidden stock subagent and on the floor on show. */
    shown: boolean;
    dir: number;
    /** The seat it holds, or null. */
    seat: string | null;
    /** Where an idle lead's route takes it (the Lounge, a break or lunch), or null. */
    routine: RoutineView | null;
  }>;
  /** Every stock subagent: where it works. */
  subagents: Array<{
    id: number;
    parent: number | null;
    col: number;
    row: number;
    state: string;
    dir: number;
    /** A person stands in for it. */
    hidden: boolean;
    /** The seat it works on, or null. */
    seat: string | null;
    /** The tile it stands at before a prop, or null. */
    stand: Tile | null;
    /** What it does, from its type (whether or not it holds a station now). */
    activity: Activity;
    /** Whether it holds a station now. */
    station: boolean;
    /** Sent to the pod's water cooler. */
    cooler: boolean;
  }>;
  hidden: number[];
  /** Whether subagent meetings may happen (the self-test turns them off for some steps). */
  meetingsOn: boolean;
  /** The meeting running: the two subagent ids, the two seats, how many are seated, and the seconds left (a whole 8 until both sit). */
  huddle: { subs: [number, number]; seats: [string, string]; seated: number; left: number } | null;
  /** How many meetings have been held (counted when both sat). */
  huddlesHeld: number;
  /** How many effects of each kind have started (counted, so a short one isn't missed by a poll). */
  fxStarted: Record<string, number>;
  /** The tube station and its queue (the front tile first), or null when the layout has none. */
  tube: { col: number; row: number; queue: Tile[] } | null;
  /** How many capsules have been posted. */
  tubeSent: number;
  /** The last posts: the lead and the tile it stood on (the front tile). */
  tubePosts: Array<{ id: number; col: number; row: number }>;
  /** How many handoffs were set on a receiver's desk, the last ones (the `seq`, who carried it or -1 for a placed one, and the tile). */
  handoffsDelivered: number;
  handoffDeliveries: Array<{ seq: number; id: number; col: number; row: number }>;
  /** How many leads are carrying a handoff, how many wait, and the capsules on desks (the tile each is drawn on). */
  activeHandoffs: number;
  queuedHandoffs: number;
  deskCapsules: Array<{ seq: number; col: number; row: number }>;
  badges: Record<string, number>;
  /** The front desk's people: where they sit and the bubble they show. */
  npcs: Array<{
    role: DeskRole;
    seat: string;
    id: number;
    col: number;
    row: number;
    dir: number;
    greeting: string | null;
  }>;
  /** How many greetings each role has shown. */
  greetings: Record<DeskRole, number>;
  /** The name over each character on show: its key, its sprite's palette, its first name and its role. */
  labels: NameLabel[];
  /** Proton, the owner's cat: her tile, what she does, the tiles she has stepped, the nap seat she holds and the kind of spot; null when not on show. */
  proton: {
    col: number;
    row: number;
    mode: string;
    moves: number;
    seat: string | null;
    spot: string | null;
  } | null;
}
