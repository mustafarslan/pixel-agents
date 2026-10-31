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
import type { Character } from '../office/types.js';
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
import {
  type AeroFloor,
  type AeroPods,
  type AeroUpdate,
  agentTypeFromStatus,
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
  /** The worktree room a project agent belongs to, or null (the owner's agents match any lead). */
  room: string | null;
  name: string;
  ch: Character;
  /** The stock subagent character this one stands in for, while it is away. */
  subId: number | null;
  /** Walking home after an away trip: a poof when it gets there. */
  returning: boolean;
}

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

  private cachedLayout: unknown = null;
  private cachedSeats: unknown = null;
  private nextPersonSlot = 0;

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
    this.rehomePeople();
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

  private occupied(except: number): Set<string> {
    const taken = new Set<string>();
    for (const other of this.os.characters.values()) {
      if (other.id !== except && !this.offFloor.has(other.id)) {
        taken.add(key(other.tileCol, other.tileRow));
      }
    }
    for (const person of this.people) {
      if (this.personOnFloor(person)) taken.add(key(person.ch.tileCol, person.ch.tileRow));
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
    if (this.syncing) return;
    this.syncing = true;
    try {
      const parked = this.parkOffFloor();
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
      if (parked || arrivals.length > 0) this.os.refreshFurniture();
    } finally {
      this.syncing = false;
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
   * otherwise by its room (the owner's agents, with none, are on every floor).
   */
  private personOnFloor(person: Person): boolean {
    if (person.subId !== null) {
      const sub = this.os.characters.get(person.subId);
      if (sub) return this.onFloor(sub);
    }
    return this.roomOnFloor(person.room);
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
    this.watchUpdate(update);
    for (const person of [...this.people]) this.stepPerson(person, dt);
    this.fx.update(dt);
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
    const idOf = (slug: string, room: string | null): string => `${room ?? ''}/${slug}`;
    const wanted = new Map(
      update ? update.agents.map((a) => [idOf(a.slug, a.room ?? null), a.name]) : [],
    );
    for (const person of this.people) {
      const name = wanted.get(idOf(person.slug, person.room));
      if (name === undefined) {
        if (person.ch.matrixEffect !== 'despawn') {
          this.unhide(person);
          person.subId = null;
          startMatrixEffect(person.ch, 'despawn');
        }
      } else {
        person.name = name;
      }
    }
    if (!update) return;
    for (const agent of update.agents) {
      const room = agent.room ?? null;
      if (
        this.people.some(
          (p) => p.slug === agent.slug && p.room === room && p.ch.matrixEffect !== 'despawn',
        )
      )
        continue;
      const spot = this.freeLoungeTile();
      if (!spot) continue;
      const slot = this.nextPersonSlot++;
      const palettes = Math.max(1, getLoadedCharacterCount());
      const ch = createCharacter(
        PERSON_ID_BASE - slot,
        slot % palettes,
        null,
        null,
        Math.floor(slot / palettes) * 60,
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
        room,
        name: agent.name,
        ch,
        subId: null,
        returning: false,
      });
    }
  }

  /** Shows the stock subagent a configured character stood in for again. */
  private unhide(person: Person): void {
    if (person.subId === null) return;
    const sub = this.os.characters.get(person.subId);
    if (sub) sub.aeroHidden = false;
  }

  private freeLoungeTile(): Tile | null {
    const taken = this.occupied(Number.NaN);
    const free = this.loungeWalkable.filter((t) => !taken.has(key(t.col, t.row)));
    if (free.length === 0) return null;
    return free[Math.floor(this.rng() * free.length) % free.length];
  }

  private stepPerson(person: Person, dt: number): void {
    const os = this.os;
    const ch = person.ch;
    const effect = advanceMatrixEffect(ch, dt);
    if (effect !== 'none') {
      if (effect === 'despawned') this.people = this.people.filter((p) => p !== person);
      return;
    }
    // Its stand-in is gone: walk back to the Lounge.
    if (person.subId !== null && !os.subagentMeta.has(person.subId)) {
      person.subId = null;
      person.returning = true;
      ch.isActive = false;
      const spot = this.freeLoungeTile();
      ch.state = CharacterState.IDLE;
      ch.wanderTimer = 0.5;
      if (spot && this.pathTo(ch, spot).length > 0) {
        ch.path = this.pathTo(ch, spot);
        ch.moveProgress = 0;
        ch.state = CharacterState.WALK;
        ch.frame = 0;
        ch.frameTimer = 0;
      }
    }
    // Home it wanders over the Lounge floor only; away it is active and types where it stopped.
    const walkable = person.subId === null ? this.loungeWalkable : os.walkableTiles;
    updateCharacter(ch, dt, walkable, os.seats, os.tileMap, os.blockedTiles);
    // Home again: a poof where the trip ends.
    if (person.returning && ch.state !== CharacterState.WALK) {
      person.returning = false;
      if (this.personOnFloor(person)) this.poofAt(ch);
    }
  }

  /** The people at home stand on the Lounge floor: after a new layout, one that isn't on it moves to a free tile of it. */
  private rehomePeople(): void {
    const onFloor = new Set(this.loungeWalkable.map((t) => key(t.col, t.row)));
    for (const person of this.people) {
      const ch = person.ch;
      if (person.subId !== null || ch.matrixEffect === 'despawn') continue;
      if (onFloor.has(key(ch.tileCol, ch.tileRow))) continue;
      const spot = this.freeLoungeTile();
      if (!spot) continue;
      ch.tileCol = spot.col;
      ch.tileRow = spot.row;
      this.stand(ch);
      ch.wanderTimer = 1;
    }
  }

  /**
   * A SubagentStart named `status`'s type. If it matches a configured character that is free, that character walks to the
   * lead's room, the stock subagent is hidden, and true is returned.
   */
  subagentStarted(parentId: number, parentToolId: string, status: unknown): boolean {
    const type = agentTypeFromStatus(status);
    if (type === null) return false;
    const lead = this.os.characters.get(parentId);
    if (!lead) return false;
    // A project agent only for a lead in its room (preferred); the owner's agents (no room) for any lead.
    // One that is still spawning matches too; one that is despawning does not. (Two subagents of one type at once: the second
    // stays stock while the character is away.)
    const free = (p: Person): boolean =>
      p.slug === type && p.ch.matrixEffect !== 'despawn' && p.subId === null;
    const person =
      this.people.find((p) => free(p) && p.room !== null && p.room === lead.directoryName) ??
      this.people.find((p) => free(p) && p.room === null);
    if (!person) return false;
    const subId = this.os.getSubagentId(parentId, parentToolId);
    const sub = subId === null ? undefined : this.os.characters.get(subId);
    if (subId === null || !sub) return false;
    sub.aeroHidden = true;
    person.subId = subId;
    person.returning = false;
    const ch = person.ch;
    // A stand-in for a subagent of another floor is hidden with it: no poof.
    if (this.personOnFloor(person)) this.poofAt(ch);
    ch.isActive = true;
    const taken = this.occupied(Number.NaN);
    // To the lead's seat (its desk), not to wherever the lead stands now: a lead resting in the Lounge is not where the work is.
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
      } else {
        ch.state = CharacterState.IDLE;
      }
    }
    return true;
  }

  // ── Where OfficeState joins them in ─────────────────────────────

  /** The characters the renderer draws: `list` less the hidden stock subagents, plus the configured ones. */
  characters(list: Character[]): Character[] {
    const shown = list.filter((ch) => !this.hides(ch));
    for (const person of this.people) if (this.personOnFloor(person)) shown.push(person.ch);
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

  /** What the `getAero` test hook shows. */
  snapshot(): AeroSnapshot {
    this.refresh();
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
        room: p.room,
        name: p.name,
        id: p.ch.id,
        col: p.ch.tileCol,
        row: p.ch.tileRow,
        state: p.ch.state,
        away: p.subId !== null,
      })),
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
    room: string | null;
    name: string;
    id: number;
    col: number;
    row: number;
    state: string;
    away: boolean;
  }>;
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
}
