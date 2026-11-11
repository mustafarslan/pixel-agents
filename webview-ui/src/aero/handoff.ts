/**
 * Tower handoffs in the office (docs/work/phase6-handoff/plan.md), the pure part: the queue and what a walk is made of.
 *
 * Aero says which handoffs are pending (`seq` and the two rooms, nothing else: see update.ts). The sender's lead walks a capsule to
 * the receiver's pod, or posts it into the tube when the receiver is not there; with no sender in the office the tube pops it and
 * the receiver collects it. At most two walk at once, up to eight wait (FIFO, once per `floor:seq`); past that a capsule is placed on
 * the receiver's desk with no walk. `office.ts` does the walking: it asks `planHandoff` for the stages and feeds the answers back.
 *
 * A gated handoff (it waits on the owner's verdict: docs/work/phase6-gated-route/plan.md) takes another route: the sender pins the
 * capsule to the meeting-room whiteboard and goes home (`pin`); when the gate clears, the receiver walks to the board, lifts it and
 * carries it to its desk (`board`). The book follows `(floor, seq, gated)` for that: see `HandoffBook.gate`.
 */
import { Direction } from '../office/types.js';
import type { AeroHandoff } from './update.js';

type Tile = { col: number; row: number };

export const MAX_ACTIVE_HANDOFFS = 2;
export const MAX_QUEUED_HANDOFFS = 8;
/** How long the walker stands at its stop before it goes on. */
export const HANDOFF_PAUSE_SEC = 0.6;
/** A walk that is dropped (a path that closed, a lead that left) is queued again this many times, then forgotten. */
const MAX_TRIES = 2;
const MAX_SEEN = 256;
const MAX_DELIVERIES = 32;

/** The two legs of a gated handoff: the sender pins the capsule to the board, the receiver lifts it from there. */
export type HandoffRoute = 'pin' | 'board';

export interface QueuedHandoff extends AeroHandoff {
  tries: number;
  /** Set for a gated handoff's legs; absent for an ordinary walk. */
  route?: HandoffRoute;
  /** The capsule was already taken out of the tube (a walk that was dropped after that does not collect it again). */
  collected?: boolean;
}

/** What a stop is for: setting the capsule on the receiver's desk, posting it, or taking it out of the tube. */
export type StageAct = 'deliver' | 'post' | 'collect' | 'home' | 'pin' | 'unpin';

export interface HandoffStage {
  tile: Tile;
  dir: Direction;
  pause: number;
  act: StageAct;
  /** The seat it sits on at the end of the walk (home), else null. */
  seatUid: string | null;
}

/** A room's lead in the office: where it sits, and its pod's top-left (null at a hot desk). */
export interface HandoffParty {
  home: Tile;
  seatUid: string | null;
  pod: Tile | null;
}

export interface HandoffPlan {
  /** Whose lead walks. */
  walker: 'sender' | 'receiver';
  stages: HandoffStage[];
  /** A tile the walk needs is held now (the tube's front, or all of the receiver's stops): it could be carried, but waits. */
  busy: boolean;
}

export interface HandoffWorld {
  sender: HandoffParty | null;
  receiver: HandoffParty | null;
  /** The tube's front tile, or null (no tube). */
  tube: Tile | null;
  /** Whether nobody holds the tile and it can be stood on. */
  free: (tile: Tile) => boolean;
  /** The capsule was already taken out of the tube (or off the board): only the walk to the desk is left. */
  collected?: boolean;
  /** The tile in front of the meeting-room whiteboard, or null (no whiteboard, or the pods are not in force). */
  board?: Tile | null;
  /** Which leg of a gated handoff this is; absent for an ordinary walk. */
  route?: HandoffRoute;
}

/** The tile the capsule is brought to, and which way the walker faces there: the right bench, the left one, else the aisle; null when none is free. */
export function receiverStop(
  pod: Tile,
  free: (tile: Tile) => boolean,
): { tile: Tile; dir: Direction } | null {
  const right = { col: pod.col + 5, row: pod.row + 2 };
  if (free(right)) return { tile: right, dir: Direction.LEFT };
  const left = { col: pod.col + 1, row: pod.row + 2 };
  if (free(left)) return { tile: left, dir: Direction.RIGHT };
  const aisle = { col: pod.col + 4, row: pod.row + 3 };
  return free(aisle) ? { tile: aisle, dir: Direction.LEFT } : null;
}

/** Where a capsule lies on a desk (world tile), for the receiver pod. */
export function deskTile(pod: Tile): Tile {
  return { col: pod.col + 4, row: pod.row };
}

const home = (party: HandoffParty): HandoffStage => ({
  tile: { ...party.home },
  dir: Direction.DOWN,
  pause: 0,
  act: 'home',
  seatUid: party.seatUid,
});

/**
 * How a handoff is carried, or null when there is nobody to carry it (the receiver has no pod, the sender is not in the office, and
 * there is no tube). A plan that is `busy` waits for a held tile.
 */
export function planHandoff(world: HandoffWorld): HandoffPlan | null {
  const { sender, receiver, tube } = world;
  if (world.collected && receiver?.pod) {
    const desk = home(receiver);
    desk.act = 'deliver';
    desk.pause = HANDOFF_PAUSE_SEC;
    return { walker: 'receiver', stages: [desk], busy: false };
  }
  const board = world.board ?? null;
  const atBoard = (act: StageAct, tile: Tile): HandoffStage => ({
    tile: { ...tile },
    dir: Direction.UP,
    pause: HANDOFF_PAUSE_SEC,
    act,
    seatUid: null,
  });
  // A gated handoff: the sender pins it to the whiteboard, and the receiver lifts it from there.
  if (world.route === 'pin') {
    if (!sender || !board) return null;
    return {
      walker: 'sender',
      stages: [atBoard('pin', board), home(sender)],
      busy: !world.free(board),
    };
  }
  if (world.route === 'board') {
    if (!receiver?.pod || !board) return null;
    const desk = home(receiver);
    desk.act = 'deliver';
    desk.pause = HANDOFF_PAUSE_SEC;
    return {
      walker: 'receiver',
      stages: [atBoard('unpin', board), desk],
      busy: !world.free(board),
    };
  }
  if (receiver?.pod && sender) {
    const stop = receiverStop(receiver.pod, world.free);
    const wait = { walker: 'sender', busy: true } as const;
    if (!stop) return { ...wait, stages: [home(sender)] };
    return {
      walker: 'sender',
      stages: [
        { tile: stop.tile, dir: stop.dir, pause: HANDOFF_PAUSE_SEC, act: 'deliver', seatUid: null },
        home(sender),
      ],
      busy: false,
    };
  }
  if (!tube) return null;
  const needTube = (plan: Omit<HandoffPlan, 'busy'>): HandoffPlan => ({
    ...plan,
    busy: !world.free(tube),
  });
  const atTube = (act: StageAct): HandoffStage => ({
    tile: { ...tube },
    dir: Direction.UP,
    pause: HANDOFF_PAUSE_SEC,
    act,
    seatUid: null,
  });
  // The receiver is not there (or at a hot desk): the sender posts it.
  if (sender && !receiver?.pod)
    return needTube({ walker: 'sender', stages: [atTube('post'), home(sender)] });
  // The sender is not there: the tube pops it, the receiver collects it and takes it to its desk.
  if (receiver?.pod) {
    const desk = home(receiver);
    desk.act = 'deliver';
    desk.pause = HANDOFF_PAUSE_SEC;
    return needTube({ walker: 'receiver', stages: [atTube('collect'), desk] });
  }
  return null;
}

/** A delivery the page made: the handoff, who carried it, and the tile it was set down from (the self-test reads these). */
export interface HandoffDelivery {
  seq: number;
  id: number;
  col: number;
  row: number;
}

export class HandoffBook {
  /** The floor the list was last for (null before the first list). */
  floor: string | null = null;
  queue: QueuedHandoff[] = [];
  /** Handoffs nobody can carry now (no sender, receiver or tube to do it): outside the eight, tried again as the office changes. */
  waiting: QueuedHandoff[] = [];
  /** The capsules on desks: the handoff's `seq` to its receiver's room. */
  desk = new Map<number, string>();
  delivered = 0;
  deliveries: HandoffDelivery[] = [];
  /**
   * Where each gated handoff's capsule is: `walking` (its sender is on the way to pin it, nothing is on the board yet), `pinned` (on
   * the board) or `lifting` (the gate cleared: on the board until the receiver takes it). A seq leaves it when it leaves the list.
   */
  gate = new Map<number, 'walking' | 'pinned' | 'lifting'>();
  /** The pins a sender walked, or the tube popped (-1), the last ones: the tile is the board's front. */
  pins: HandoffDelivery[] = [];
  /** Capsules nobody can walk to the board (a pin) or off it (a lift): the office pops them at the tube. Drained by `takePops`. */
  private pops: Array<{ item: AeroHandoff; kind: 'pin' | 'lift' }> = [];
  /** The `seq`s of the list now. */
  private listed = new Set<number>();
  /** Queued, waiting or on their way: not on a desk yet, and not to be placed there before they arrive. */
  private pending = new Set<number>();
  private seen = new Set<string>();

  isListed(seq: number): boolean {
    return this.listed.has(seq);
  }

  /**
   * A new list for `floor`. The first one after a page load or a floor switch (`reset`) places a capsule for each handoff without a
   * walk. Later, each handoff not seen before on this floor is queued (`fresh`), or, with the queue full, `overflow`: the capsule
   * goes straight to the desk. One that nobody can carry now (`plannable` says no) waits outside the queue. A capsule leaves its desk,
   * and a waiting handoff the queue, when its `seq` leaves the list; a seq that comes back, or whose receiver was unknown and now
   * is, is placed on its desk with no walk.
   */
  ingest(
    floor: string,
    list: readonly AeroHandoff[],
    plannable: (item: AeroHandoff) => boolean = () => true,
  ): { reset: boolean; overflow: AeroHandoff[] } {
    this.listed = new Set(list.map((h) => h.seq));
    const reset = this.floor !== floor;
    const overflow: AeroHandoff[] = [];
    if (reset) {
      this.floor = floor;
      this.queue = [];
      this.waiting = [];
      this.pending = new Set();
      this.seen = new Set(list.map((h) => `${floor}:${h.seq}`));
      this.desk = new Map();
      this.gate = new Map();
      this.pops = [];
      for (const h of list) {
        if (h.gated === true) this.gate.set(h.seq, 'pinned');
        else if (h.toRoom !== null) this.desk.set(h.seq, h.toRoom);
      }
      return { reset, overflow };
    }
    this.queue = this.queue.filter((q) => this.listed.has(q.seq));
    this.waiting = this.waiting.filter((q) => this.listed.has(q.seq));
    for (const seq of [...this.pending]) if (!this.listed.has(seq)) this.pending.delete(seq);
    for (const seq of [...this.desk.keys()]) if (!this.listed.has(seq)) this.desk.delete(seq);
    for (const seq of [...this.gate.keys()]) if (!this.listed.has(seq)) this.gate.delete(seq);
    for (const h of list) {
      const id = `${floor}:${h.seq}`;
      const state = this.gate.get(h.seq);
      if (this.seen.has(id)) {
        if (h.gated === true) {
          // A gate that shut on a handoff already seen: its capsule goes to the board with no walk.
          if (state === undefined) {
            this.desk.delete(h.seq);
            this.gate.set(h.seq, 'pinned');
          }
        } else if (state === 'walking') {
          // The gate cleared before the sender pinned it: an ordinary handoff from here.
          this.gate.delete(h.seq);
          this.queue = this.queue.filter((q) => q.seq !== h.seq);
          this.pending.delete(h.seq);
          this.enqueue(h, plannable, overflow);
        } else if (state === 'pinned') {
          this.lift(h, plannable);
        } else if (state === undefined) {
          if (!this.pending.has(h.seq) && h.toRoom !== null && !this.desk.has(h.seq))
            this.desk.set(h.seq, h.toRoom);
        }
        continue;
      }
      this.seen.add(id);
      if (h.gated === true) this.pin(h, plannable);
      else this.enqueue(h, plannable, overflow);
    }
    // The oldest are forgotten first, but never one that is listed now (it would be walked as if it were new).
    if (this.seen.size > MAX_SEEN) {
      for (const id of [...this.seen]) {
        if (this.seen.size <= MAX_SEEN) break;
        if (!this.listed.has(Number(id.slice(id.lastIndexOf(':') + 1)))) this.seen.delete(id);
      }
    }
    return { reset, overflow };
  }

  /** An ordinary handoff, new to the floor: queued, waiting for a carrier, or (queue full) an overflow. */
  private enqueue(
    h: AeroHandoff,
    plannable: (item: AeroHandoff) => boolean,
    overflow: AeroHandoff[],
  ): void {
    if (!plannable(h)) {
      this.pending.add(h.seq);
      this.waiting.push({ ...h, tries: 0 });
    } else if (this.queue.length >= MAX_QUEUED_HANDOFFS) {
      overflow.push(h);
    } else {
      this.pending.add(h.seq);
      this.queue.push({ ...h, tries: 0 });
    }
  }

  /** A new gated handoff: its sender walks it to the board; with no sender (or the queue full) it is pinned at once and the tube pops it. */
  private pin(h: AeroHandoff, plannable: (item: AeroHandoff) => boolean): void {
    if (
      !plannable({ ...h, route: 'pin' } as QueuedHandoff) ||
      this.queue.length >= MAX_QUEUED_HANDOFFS
    ) {
      this.gate.set(h.seq, 'pinned');
      this.pops.push({ item: h, kind: 'pin' });
      return;
    }
    this.gate.set(h.seq, 'walking');
    this.pending.add(h.seq);
    this.queue.push({ ...h, tries: 0, route: 'pin' });
  }

  /** The gate of a pinned handoff cleared: its receiver lifts it; with no receiver to (or the queue full) the tube pops it and the board is clear. */
  private lift(h: AeroHandoff, plannable: (item: AeroHandoff) => boolean): void {
    if (
      !plannable({ ...h, route: 'board' } as QueuedHandoff) ||
      this.queue.length >= MAX_QUEUED_HANDOFFS
    ) {
      this.gate.delete(h.seq);
      this.pops.push({ item: h, kind: 'lift' });
      return;
    }
    this.gate.set(h.seq, 'lifting');
    this.pending.add(h.seq);
    this.queue.push({ ...h, tries: 0, route: 'board' });
  }

  /** The capsules to pop at the tube since the last call (the office does it, with its effect and sound). */
  takePops(): Array<{ item: AeroHandoff; kind: 'pin' | 'lift' }> {
    const out = this.pops;
    this.pops = [];
    return out;
  }

  /** The `seq`s of the capsules on the board (pinned, or waiting to be lifted), lowest first. */
  boardSeqs(): number[] {
    return [...this.gate]
      .filter(([, state]) => state !== 'walking')
      .map(([seq]) => seq)
      .sort((a, b) => a - b);
  }

  /** A capsule pinned to the board (only while the handoff is still listed): `by` is the walker, or -1 for one the tube popped. */
  pinned(item: AeroHandoff, by: number, at: Tile): void {
    this.pending.delete(item.seq);
    if (!this.listed.has(item.seq)) return;
    this.gate.set(item.seq, 'pinned');
    this.pins.push({ seq: item.seq, id: by, col: at.col, row: at.row });
    if (this.pins.length > MAX_DELIVERIES) this.pins.shift();
  }

  /** A capsule lifted off the board by its receiver: it is carried now, and the board is clear of it. */
  unpinned(seq: number): void {
    this.gate.delete(seq);
  }

  /** How many handoffs wait to be walked (queued, or waiting for somebody who can). */
  get waitingCount(): number {
    return this.queue.length + this.waiting.length;
  }

  /** The first waiting handoff `pick` accepts, taken out of the queue. */
  take(pick: (item: QueuedHandoff) => boolean): QueuedHandoff | null {
    const at = this.queue.findIndex(pick);
    return at < 0 ? null : this.queue.splice(at, 1)[0];
  }

  /** A queued handoff nobody can carry now leaves the eight and waits. */
  park(item: QueuedHandoff): void {
    const at = this.queue.indexOf(item);
    if (at >= 0) this.waiting.push(...this.queue.splice(at, 1));
  }

  /** Waiting handoffs that can be carried now join the queue, while it has room. */
  retryWaiting(plannable: (item: AeroHandoff) => boolean): void {
    this.waiting = this.waiting.filter((w) => {
      if (this.queue.length >= MAX_QUEUED_HANDOFFS || !plannable(w)) return true;
      this.queue.push(w);
      return false;
    });
  }

  /** A walk that was dropped before it delivered: back to the front of the queue, a limited number of times. */
  requeue(item: QueuedHandoff): void {
    const forgotten = item.tries >= MAX_TRIES || !this.listed.has(item.seq);
    // A pin that was given up on is pinned all the same; a lift given up on (not yet taken off) leaves the board: the desk is its place.
    const state = this.gate.get(item.seq);
    const stale =
      (item.route === 'pin' && state !== 'walking') ||
      (item.route === 'board' && !item.collected && state !== 'lifting');
    if (forgotten || stale) {
      this.pending.delete(item.seq);
      if (!stale && item.route === 'pin' && state === 'walking') this.gate.set(item.seq, 'pinned');
      if (!stale && item.route === 'board' && state === 'lifting') this.gate.delete(item.seq);
      return;
    }
    this.queue.unshift({ ...item, tries: item.tries + 1 });
  }

  /** A capsule posted into the tube: it is not on its way any more. */
  finish(seq: number): void {
    this.pending.delete(seq);
  }

  /** A capsule for a receiver that has no pod here: its desk entry is kept (it is drawn when the receiver has a pod), nothing counts. */
  place(item: AeroHandoff): void {
    if (item.toRoom !== null && this.listed.has(item.seq)) this.desk.set(item.seq, item.toRoom);
  }

  /** A capsule set down on its receiver's desk (only while the handoff is still listed). */
  deliver(item: AeroHandoff, by: number, at: Tile): void {
    this.pending.delete(item.seq);
    this.place(item);
    this.delivered++;
    this.deliveries.push({ seq: item.seq, id: by, col: at.col, row: at.row });
    if (this.deliveries.length > MAX_DELIVERIES) this.deliveries.shift();
  }
}

/** The top-left tile of each pod's label ("Pod 3" and so on), from one scan of the layout's tiles. */
export function podOriginMap(
  areaTiles: ReadonlyArray<string | null> | undefined,
  cols: number,
  rows: number,
): Map<string, Tile> {
  const boxes = new Map<string, Tile>();
  if (!areaTiles) return boxes;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const label = areaTiles[row * cols + col];
      if (typeof label !== 'string' || !/^Pod \d+$/.test(label)) continue;
      const box = boxes.get(label);
      boxes.set(
        label,
        box ? { col: Math.min(box.col, col), row: Math.min(box.row, row) } : { col, row },
      );
    }
  }
  return boxes;
}

/** The top-left tile of the area labelled `label` (a pod's origin), or null when it is not a pod's label or has no tiles. */
export function podOriginOf(
  areaTiles: ReadonlyArray<string | null> | undefined,
  cols: number,
  rows: number,
  label: string | null,
): Tile | null {
  return label === null ? null : (podOriginMap(areaTiles, cols, rows).get(label) ?? null);
}
