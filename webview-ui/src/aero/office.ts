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
import {
  findLounge,
  type Lounge,
  type LoungeItem,
  tableSpots,
  type Tile,
  type WallHit,
  wallHit,
} from './lounge.js';
import { type AeroUpdate, agentTypeFromStatus, parseAeroUpdate } from './update.js';

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
  name: string;
  ch: Character;
  /** The stock subagent character this one stands in for, while it is away. */
  subId: number | null;
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
  /** Lead ids waiting on the owner (a question): they stay at their desk. */
  private awaiting = new Set<number>();
  /** Lounge floor tiles a character can walk on (not blocked). */
  loungeWalkable: Tile[] = [];
  rng: () => number = Math.random;

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
    // Routes and people pointed at the old layout.
    for (const [id, route] of this.routes) {
      const ch = os.characters.get(id);
      if (!this.lounge || (route.seatUid !== null && !os.seats.has(route.seatUid))) {
        this.routes.delete(id);
        if (ch && route.arrived) ch.state = CharacterState.IDLE;
      }
    }
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
    const update = this.enabled();
    if (ch.isSubagent || !update) {
      this.leave(ch);
      step();
      return;
    }

    // Who is waiting on the owner. Read while the bubble shows: the status message sets both at once.
    if (ch.isActive) {
      this.awaiting.delete(ch.id);
    } else if (ch.bubbleType === 'waiting') {
      if (ch.waitingAwaitingInput === true) this.awaiting.add(ch.id);
      else this.awaiting.delete(ch.id);
    }
    const holds = !ch.isActive && (ch.bubbleType === 'permission' || this.awaiting.has(ch.id));

    if (ch.isActive) {
      this.leave(ch);
      step();
      return;
    }
    if (holds) {
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
    if (!route || route.mode !== mode) {
      route = this.assign(ch, mode);
      if (!route) {
        step();
        return;
      }
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
      this.routes.delete(ch.id);
      return;
    }
    this.walkTo(ch, route.target);
  }

  /** The lead goes back to the stock rules: its route ends and, if it sat or stood in the Lounge, it gets up. */
  private leave(ch: Character): void {
    const route = this.routes.get(ch.id);
    if (!route) return;
    this.routes.delete(ch.id);
    this.chats.delete(ch.id);
    if (route.arrived) {
      ch.state = CharacterState.IDLE;
      ch.frame = 0;
      ch.frameTimer = 0;
      ch.wanderTimer = 0;
      ch.path = [];
      ch.moveProgress = 0;
    }
  }

  private occupied(except: number): Set<string> {
    const taken = new Set<string>();
    for (const other of this.os.characters.values()) {
      if (other.id !== except) taken.add(key(other.tileCol, other.tileRow));
    }
    for (const person of this.people) taken.add(key(person.ch.tileCol, person.ch.tileRow));
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
        this.routes.set(ch.id, route);
        this.arrive(ch, route);
        return route;
      }
      if (this.walkTo(ch, c.target)) {
        this.routes.set(ch.id, route);
        this.chats.delete(ch.id);
        return route;
      }
    }
    this.routes.delete(ch.id);
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

  /** Once a tick, after every character stepped. */
  afterTick(dt: number): void {
    this.refresh();
    const update = this.enabled();
    for (const id of [...this.routes.keys()]) {
      if (!this.os.characters.has(id)) {
        this.routes.delete(id);
        this.chats.delete(id);
        this.awaiting.delete(id);
      }
    }
    this.reconcilePeople(update);
    for (const person of [...this.people]) this.stepPerson(person, dt);
  }

  private reconcilePeople(update: AeroUpdate | null): void {
    const wanted = new Map(update ? update.agents.map((a) => [a.slug, a.name]) : []);
    for (const person of this.people) {
      const name = wanted.get(person.slug);
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
      if (this.people.some((p) => p.slug === agent.slug && p.ch.matrixEffect !== 'despawn'))
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
      this.people.push({ slug: agent.slug, name: agent.name, ch, subId: null });
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
  }

  /**
   * A SubagentStart named `status`'s type. If it matches a configured character that is free, that character walks to the
   * lead's room, the stock subagent is hidden, and true is returned.
   */
  subagentStarted(parentId: number, parentToolId: string, status: unknown): boolean {
    const type = agentTypeFromStatus(status);
    if (type === null) return false;
    const person = this.people.find(
      (p) => p.slug === type && p.ch.matrixEffect === null && p.subId === null,
    );
    if (!person) return false;
    const subId = this.os.getSubagentId(parentId, parentToolId);
    const sub = subId === null ? undefined : this.os.characters.get(subId);
    const lead = this.os.characters.get(parentId);
    if (subId === null || !sub || !lead) return false;
    sub.aeroHidden = true;
    person.subId = subId;
    const ch = person.ch;
    ch.isActive = true;
    const taken = this.occupied(Number.NaN);
    let best: Tile | null = null;
    let bestD = Infinity;
    for (const t of this.os.walkableTiles) {
      if (taken.has(key(t.col, t.row))) continue;
      const d = Math.abs(t.col - lead.tileCol) + Math.abs(t.row - lead.tileRow);
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
    const shown = list.filter((ch) => !ch.aeroHidden);
    for (const person of this.people) shown.push(person.ch);
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
        name: p.name,
        id: p.ch.id,
        col: p.ch.tileCol,
        row: p.ch.tileRow,
        state: p.ch.state,
        away: p.subId !== null,
      })),
      hidden: [...this.os.characters.values()].filter((c) => c.aeroHidden).map((c) => c.id),
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
    name: string;
    id: number;
    col: number;
    row: number;
    state: string;
    away: boolean;
  }>;
  hidden: number[];
  badges: Record<string, number>;
}
