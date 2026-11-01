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
import { createCharacter, updateCharacter } from '../office/engine/characters.js';
import { advanceMatrixEffect, startMatrixEffect } from '../office/engine/matrixEffectState.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { getCatalogEntry } from '../office/layout/furnitureCatalog.js';
import { findPath } from '../office/layout/tileMap.js';
import { getLoadedCharacterCount } from '../office/sprites/spriteData.js';
import type { Character, Seat } from '../office/types.js';
import { CharacterState, Direction, TILE_SIZE } from '../office/types.js';
import { Effects, type FxKind } from './effects.js';
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
import { assignFirstNames, hashKey, roleFromSlug } from './names.js';
import {
  type AeroFloor,
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
/** Where an effect's origin sits below the thing it plays on, in world pixels (the effects draw above their origin). */
const FX_BURST_DROP = 15;
const FX_COUNTDOWN_DROP = 0;
const FX_POOF_DROP = 8;

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

export interface Route {
  mode: RouteMode;
  target: Tile;
  /** The Lounge seat it sits on, or null when it stands. */
  seatUid: string | null;
  arrived: boolean;
  tries: number;
}

export interface Person {
  slug: string;
  /** The floor (the repo's floor id) a project agent is staff of, or null (the owner's agents, and the rooms' agents). */
  floor: string | null;
  /** The worktree room an agent of the Rooms style belongs to, or null (a floor's staff, and the owner's agents). */
  room: string | null;
  name: string;
  ch: Character;
  /** The stock subagent character this one stands in for, while it is away. */
  subId: number | null;
  /** Walking home after an away trip: a poof when it gets there. */
  returning: boolean;
  /** The pod bench it works on while away (borrowed, never `assigned`), or null. */
  bench: string | null;
  /** Whether it was sitting on that bench at the last look (the PC it faces follows). */
  sitting: boolean;
  /** Its bench was let go without it getting up (its floor left, or the layout was rebuilt): it stands up when it is next looked after. */
  stranded: boolean;
  /** What the world looked like when no bench was found for it: no new search until that changes (see `benchSignature`). */
  noBench: string | null;
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

  /** The pod benches people work on: seat uid to the person on it. Never `seat.assigned`. */
  private borrowed = new Map<string, Person>();
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
    this.failed.clear();
    const lift = os.layout.furniture.filter((f) => f.type === LIFT_TYPE);
    this.lobby = lift
      .flatMap((f) => {
        const w = getCatalogEntry(f.type)?.footprintW ?? LIFT_WIDTH_FALLBACK;
        return Array.from({ length: w }, (_, i) => ({ col: f.col + i, row: f.row }));
      })
      .filter((t) => !blocked.has(key(t.col, t.row)));
    // The seats are new: borrowed benches are let go, and taken again by the tick.
    for (const person of this.people) {
      if (person.bench !== null) {
        person.ch.seatId = null;
        person.bench = null;
        person.sitting = false;
        person.stranded = true;
      }
    }
    this.borrowed.clear();
    this.os.refreshFurniture();
    this.rehomePeople();
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
      this.leave(ch);
      return;
    }
    const update = this.enabled();
    if (ch.isSubagent || !update) {
      this.leave(ch);
      step();
      return;
    }

    if (ch.isActive) {
      this.leave(ch);
      step();
      return;
    }
    // Only a permission bubble holds an idle lead at its desk. A question (AskUserQuestion) is an active tool, so the lead is
    // active and stays anyway; and `idle_prompt` reaches the page as a finished turn with `awaitingInput` for every idle
    // session, so that flag says nothing about the owner being needed.
    if (ch.bubbleType === 'permission') {
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

    // Truly idle: the Lounge.
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
      this.chat(ch, route, dt);
      return;
    }
    step();
    if (ch.state === CharacterState.WALK) return;
    // The stock step ended the walk.
    if (ch.tileCol === route.target.col && ch.tileRow === route.target.row) {
      this.arrive(ch, route);
      return;
    }
    route.tries++;
    if (route.tries >= ROUTE_RETRIES) {
      this.dropRoute(ch.id);
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

  private occupied(except: number, withPeople = true): Set<string> {
    const taken = new Set<string>();
    for (const other of this.os.characters.values()) {
      if (other.id !== except && !this.offFloor.has(other.id)) {
        taken.add(key(other.tileCol, other.tileRow));
      }
    }
    if (withPeople) {
      for (const person of this.people) {
        if (this.personOnFloor(person)) taken.add(key(person.ch.tileCol, person.ch.tileRow));
      }
    }
    for (const [id, route] of this.routes) {
      if (id !== except) taken.add(key(route.target.col, route.target.row));
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
      const route: Route = { mode, target: c.target, seatUid: c.seatUid, arrived: false, tries: 0 };
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
      ch.dir = this.faceTable(route.target) ?? ch.dir;
    }
    this.chats.set(ch.id, { wait: this.between(CHAT_MIN_SEC, CHAT_MAX_SEC), text: null, show: 0 });
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
    if (route.mode === 'lunch') return '\u{1F35C}';
    return this.chats.get(id)?.text ?? null;
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
    if (ch.bubbleType === 'permission' || ch.matrixEffect === 'despawn') return;
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
    const spot = this.nearestFreeTile(anchor, ch.id) ?? { col: anchor.tileCol, row: anchor.tileRow };
    ch.tileCol = spot.col;
    ch.tileRow = spot.row;
    this.stand(ch);
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
        os.releaseSeat(ch);
        changed = true;
      } else if (off && ch.seatId) {
        // A hidden character holds no seat, however it came by one (a seat pick, a teammate link).
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

  /** Once a tick, after every character stepped. */
  afterTick(dt: number): void {
    this.syncMappings();
    this.refresh();
    this.clock += dt;
    const update = this.enabled();
    for (const id of [...this.routes.keys()]) {
      if (!this.os.characters.has(id)) this.dropRoute(id);
    }
    for (const id of [...this.failed.keys()]) {
      if (!this.os.characters.has(id)) this.failed.delete(id);
    }
    this.reconcilePeople(update);
    this.matchQueued();
    this.watchUpdate(update);
    for (const person of [...this.people]) this.stepPerson(person, dt);
    this.fx.update(dt);
    for (const npc of this.npcs) npc.greet = Math.max(0, npc.greet - dt);
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
    for (const agent of update.agents) {
      const floor = agent.floor ?? null;
      const room = agent.room ?? null;
      if (have.has(idOf(floor, room, agent.slug))) continue;
      const spot = this.freeLoungeTile({ floor, room });
      if (!spot) continue;
      const slot = this.nextPersonSlot++;
      const palettes = Math.max(1, getLoadedCharacterCount());
      // The look follows the person's key, not the order it was made in, so its first name (made from the palette) is the same
      // whenever it is made.
      const look = hashKey(idOf(floor, room, agent.slug));
      const ch = createCharacter(
        PERSON_ID_BASE - slot,
        look % palettes,
        null,
        null,
        (Math.floor(look / palettes) % 6) * 60,
      );
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
        bench: null,
        sitting: false,
        stranded: false,
        noBench: null,
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
      return;
    }
    if (person.subId !== null) this.tendBench(person);
    // Home it wanders over the Lounge floor only; away it is active and types where it stopped.
    const walkable = person.subId === null ? this.loungeWalkable : os.walkableTiles;
    updateCharacter(ch, dt, walkable, os.seats, os.tileMap, os.blockedTiles);
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
      bench: null,
      sitting: false,
      stranded: false,
      noBench: null,
      contractor: { number, idle: 0, leaving: false },
    };
    this.people.push(person);
    return person;
  }

  // ── Benches ──────────────────────────────────────────────────────

  /** Seat uids of the benches active people sit on, for the PCs they face (the office turns those on). */
  activeBenchSeats(): Seat[] {
    const seats: Seat[] = [];
    for (const [uid, person] of this.borrowed) {
      const seat = this.os.seats.get(uid);
      if (seat && person.ch.isActive && person.ch.state === CharacterState.TYPE) seats.push(seat);
    }
    return seats;
  }

  /** The PC a person faces follows whether it is sitting: the office rebuilds its furniture when that changes. */
  private watchSitting(person: Person): void {
    const sitting = person.ch.state === CharacterState.TYPE;
    if (sitting === person.sitting) return;
    person.sitting = sitting;
    this.os.refreshFurniture();
  }

  /** Lets go of the person's bench. `standUp`: it gets up and takes the nearest free tile; else it stays where it is (`stranded`). */
  private releaseBench(person: Person, standUp: boolean): void {
    if (person.bench === null) return;
    this.borrowed.delete(person.bench);
    person.bench = null;
    person.ch.seatId = null;
    const wasSitting = person.sitting;
    person.sitting = false;
    if (standUp) this.standAside(person);
    else person.stranded = true;
    if (wasSitting) this.os.refreshFurniture();
  }

  /** The person gets up where it is and walks to the nearest free tile (or just stands when there is none it can reach). */
  private standAside(person: Person): void {
    const ch = person.ch;
    person.stranded = false;
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

  /** Keeps a working person's bench honest: gone when somebody was seated on it or the lead's pod changed, taken when one is free. */
  private tendBench(person: Person): void {
    const os = this.os;
    const meta = person.subId === null ? undefined : os.subagentMeta.get(person.subId);
    const lead = meta ? os.characters.get(meta.parentAgentId) : undefined;
    if (!lead || !lead.seatId) {
      // Nothing to sit beside: a person that lost its bench still gets up.
      if (person.bench === null && person.stranded) this.standAside(person);
      return;
    }
    if (person.bench !== null) {
      const seat = os.seats.get(person.bench);
      const zone = os.seatZone(lead.seatId);
      if (!seat || seat.assigned || (zone !== null && os.seatZone(person.bench) !== zone)) {
        this.releaseBench(person, true);
      }
    }
    if (person.bench === null) {
      if (this.takeBench(person, lead.seatId)) person.stranded = false;
      // No bench for a person that was sitting on one it no longer holds: it may not stay on a tile it doesn't own.
      else if (person.stranded) this.standAside(person);
    }
  }

  /** What decides whether a bench search can find something new: the seats taken, the benches borrowed, the routes, the lead's seat. */
  private benchSignature(leadSeatId: string): string {
    let h = this.borrowed.size;
    let i = 0;
    for (const seat of this.os.seats.values()) {
      i++;
      if (seat.assigned) h = (h * 31 + i) | 0;
    }
    return `${leadSeatId}|${h}|${this.occupancy}|${this.os.seats.size}`;
  }

  /** Walks the person to the nearest free wooden bench of the lead's pod facing a PC; false when there is none it can reach. */
  private takeBench(person: Person, leadSeatId: string): boolean {
    const os = this.os;
    const ch = person.ch;
    const signature = this.benchSignature(leadSeatId);
    if (person.noBench === signature) return false;
    for (const uid of os.benchSeatsFor(leadSeatId, this.borrowed)) {
      const seat = os.seats.get(uid);
      if (!seat) continue;
      const at = ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow;
      const path = at ? [] : this.pathTo(ch, { col: seat.seatCol, row: seat.seatRow });
      if (!at && path.length === 0) continue;
      this.borrowed.set(uid, person);
      person.bench = uid;
      ch.seatId = uid;
      ch.isActive = true;
      if (at) {
        this.stand(ch);
        ch.state = CharacterState.TYPE;
        ch.dir = seat.facingDir;
      } else {
        ch.path = path;
        ch.moveProgress = 0;
        ch.state = CharacterState.WALK;
        ch.frame = 0;
        ch.frameTimer = 0;
      }
      person.noBench = null;
      return true;
    }
    person.noBench = signature;
    return false;
  }

  private nearestFreeTile(from: { tileCol: number; tileRow: number }, except = Number.NaN): Tile | null {
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
    // Its last stand-in ended before the tick sent it home: it keeps the tile it stands on, and lets go of the bench.
    if (person.subId !== null) this.releaseBench(person, false);
    sub.aeroHidden = true;
    person.subId = subId;
    person.returning = false;
    person.stranded = false;
    const ch = person.ch;
    // A stand-in for a subagent of another floor is hidden with it: no poof.
    if (!hired && this.personOnFloor(person)) this.poofAt(ch);
    ch.isActive = true;
    // A free bench at a PC of the lead's pod, else the free tile nearest its desk (the lead's seat, not wherever the lead stands now:
    // a lead resting in the Lounge is not where the work is).
    if (lead.seatId && this.takeBench(person, lead.seatId)) return true;
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

  private labelCache: { sig: string; labels: NameLabel[] } | null = null;

  /**
   * The name over every character on show. Keys: a person by `floor/room/slug` (a contractor's adds `#number`), the front desk by
   * role, a lead by its folder and its rank by id among the leads of that folder, a teammate by its lead's key and its rank, and a
   * stock subagent likewise by its parent's. Nothing from a transcript (`agentName`, a subagent's type) is used. The first names are
   * made together (see `assignFirstNames`), so no two on show are the same.
   */
  labels(): NameLabel[] {
    type Entry = Omit<NameLabel, 'first'>;
    const entries: Entry[] = [];
    for (const p of this.people) {
      if (!this.personOnFloor(p)) continue;
      const base = personId(p.floor, p.room, p.slug);
      entries.push({
        id: p.ch.id,
        kind: p.contractor ? 'contractor' : 'person',
        key: p.contractor ? `${base}#${p.contractor.number}` : base,
        palette: p.ch.palette,
        role: p.contractor
          ? `${roleFromSlug(p.slug)} #${p.contractor.number}`
          : roleFromSlug(p.slug),
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
    const shown = [...this.os.characters.values()].filter((c) => !this.hides(c) && !c.isGreeter);
    const keyOf = new Map<number, string>();
    const rankIn = (group: Character[], ch: Character, descending: boolean): number =>
      [...group].sort((a, b) => (descending ? b.id - a.id : a.id - b.id)).indexOf(ch);
    const leads = shown.filter((c) => !c.isSubagent && c.leadAgentId === undefined);
    for (const ch of leads) {
      const folder = ch.directoryName ?? '';
      const key = `lead/${folder}/${rankIn(
        leads.filter((o) => (o.directoryName ?? '') === folder),
        ch,
        false,
      )}`;
      keyOf.set(ch.id, key);
      entries.push({
        id: ch.id,
        kind: 'lead',
        key,
        palette: ch.palette,
        role: folder === PR_RUNS_ROOM ? 'PR' : 'Lead',
      });
    }
    const keyOfParent = (id: number | null | undefined): string =>
      (id === null || id === undefined ? undefined : keyOf.get(id)) ?? 'lead/?';
    const mates = shown.filter((c) => !c.isSubagent && c.leadAgentId !== undefined);
    for (const ch of mates) {
      const group = mates.filter((o) => o.leadAgentId === ch.leadAgentId);
      const key = `${keyOfParent(ch.leadAgentId)}/mate/${rankIn(group, ch, false)}`;
      keyOf.set(ch.id, key);
      entries.push({ id: ch.id, kind: 'teammate', key, palette: ch.palette, role: 'Teammate' });
    }
    const subs = shown.filter((c) => c.isSubagent);
    for (const ch of subs) {
      const group = subs.filter((o) => o.parentAgentId === ch.parentAgentId);
      const key = `${keyOfParent(ch.parentAgentId)}/sub/${rankIn(group, ch, true)}`;
      entries.push({ id: ch.id, kind: 'subagent', key, palette: ch.palette, role: 'Subagent' });
    }
    const sig = entries.map((e) => `${e.key}|${e.palette}|${e.role}|${e.id}`).join('\n');
    if (this.labelCache?.sig === sig) return this.labelCache.labels;
    const firsts = assignFirstNames(entries);
    const labels = entries.map((e) => ({ ...e, first: firsts.get(e.key) ?? '' }));
    this.labelCache = { sig, labels };
    return labels;
  }

  /** What the `getAero` test hook shows. */
  snapshot(): AeroSnapshot {
    this.refresh();
    this.holdFrontDesk();
    const update = getAeroUpdate();
    return {
      update,
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
        kind: p.contractor ? ('contractor' as const) : ('person' as const),
        number: p.contractor?.number ?? 0,
        idle: Math.floor(p.contractor?.idle ?? 0),
        leaving: p.contractor?.leaving ?? false,
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
        })),
      hidden: [...this.os.characters.values()].filter((c) => c.aeroHidden).map((c) => c.id),
      fxStarted: { ...this.fx.started },
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
      labels: this.labels().map((l) => ({ ...l })),
    };
  }
}

export interface AeroSnapshot {
  update: AeroUpdate | null;
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
  }>;
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
    /** The pod bench it works on, or null. */
    bench: string | null;
    kind: 'person' | 'contractor';
    /** A contractor's number (its name's `#N`), 0 for a person. */
    number: number;
    /** A contractor's whole seconds without work. */
    idle: number;
    leaving: boolean;
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
  }>;
  hidden: number[];
  /** How many effects of each kind have started (counted, so a short one isn't missed by a poll). */
  fxStarted: Record<string, number>;
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
}
