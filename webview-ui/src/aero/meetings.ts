/**
 * Subagent meetings (docs/work/phase6-meetings/plan.md): two subagents of one lead that work together for a while get up and hold a
 * short meeting at the meeting room's table, once per subagent. Pure rules only; `AeroOffice` does the walking and the seating.
 *
 * A subagent's time is counted from when it holds a station and types there (the office keeps that map); the pair that has worked
 * together longest meets first, ties by id. Subagents are keyed by their subagent id (never reused), not by their character.
 */
import { Direction } from '../office/types.js';

/** Both must have held a station and worked this long before they meet. */
export const HUDDLE_AFTER_SEC = 3;
/** A meeting lasts this long once both are seated. */
export const HUDDLE_SEC = 8;
/** A meeting whose seats are not both reached within this long ends (one stuck walk may not block the floor's meetings). */
export const HUDDLE_WALK_SEC = 30;
/** After a meeting found no walkable pair of seats, no search again for this long. */
export const HUDDLE_RETRY_SEC = 2;

/** The bubbles over two that meet: from this table only. */
export const HUDDLE_BUBBLES = ['\u{1F4AC}', '\u{1F91D}', '\u{1F5E3}\u{FE0F}'] as const;

/** A subagent that holds a station and works there, with the lead it belongs to and since when (the tick clock). */
export interface Working {
  id: number;
  lead: number;
  since: number;
}

/**
 * Keeps `since` in step with who is working now: a subagent that is not working is forgotten (so any break resets its time), one that
 * just started is stamped `now`.
 */
export function trackWorking(
  since: Map<number, number>,
  working: ReadonlySet<number>,
  now: number,
): void {
  for (const id of [...since.keys()]) if (!working.has(id)) since.delete(id);
  for (const id of working) if (!since.has(id)) since.set(id, now);
}

/**
 * The pair that meets next: two subagents of one lead, neither met yet, both working for at least `HUDDLE_AFTER_SEC` together; the pair
 * that has worked together longest first, ties by the lower ids. Null when there is none.
 */
export function pickPair(
  working: readonly Working[],
  met: ReadonlySet<number>,
  now: number,
): [number, number] | null {
  const byLead = new Map<number, Working[]>();
  for (const w of working) {
    if (met.has(w.id)) continue;
    let list = byLead.get(w.lead);
    if (!list) byLead.set(w.lead, (list = []));
    list.push(w);
  }
  let best: { together: number; ids: [number, number] } | null = null;
  for (const list of byLead.values()) {
    list.sort((a, b) => a.id - b.id);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const together = now - Math.max(list[i].since, list[j].since);
        if (together < HUDDLE_AFTER_SEC) continue;
        const ids: [number, number] = [list[i].id, list[j].id];
        if (
          !best ||
          together > best.together ||
          (together === best.together &&
            (ids[0] < best.ids[0] || (ids[0] === best.ids[0] && ids[1] < best.ids[1])))
        )
          best = { together, ids };
      }
    }
  }
  return best ? best.ids : null;
}

/** A free seat, as the pairing looks at it. */
export interface HuddleSeat {
  uid: string;
  col: number;
  row: number;
  dir: number;
}

/**
 * The pairs of seats that face each other: the same row, the left one facing right and the right one facing left. Nearest chairs
 * first, ties by uid. (The two head chairs of a table both face down, so they never pair.)
 */
export function facingPairs(seats: readonly HuddleSeat[]): Array<[HuddleSeat, HuddleSeat]> {
  const out: Array<[HuddleSeat, HuddleSeat]> = [];
  for (const a of seats) {
    if (a.dir !== Direction.RIGHT) continue;
    for (const b of seats) {
      if (b.dir === Direction.LEFT && b.row === a.row && b.col > a.col) out.push([a, b]);
    }
  }
  return out.sort(
    (p, q) =>
      p[1].col - p[0].col - (q[1].col - q[0].col) ||
      (p[0].uid + p[1].uid < q[0].uid + q[1].uid ? -1 : 1),
  );
}
