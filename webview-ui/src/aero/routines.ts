/**
 * Aero's breaks, the pure part (docs/work/phase6-breaks/plan.md): what an idle character does next, and for how long.
 *
 * An idle person picks its next place every 25-45 seconds: about half the picks are a break (the water cooler, coffee, the vending
 * machine, a smoke on the terrace), the rest the Lounge, as before. Lunch is not picked: at 12:00 everyone goes to the café. Nothing
 * here knows the office; `office.ts` asks the layout for targets and feeds the answers in. Every random choice takes the rng it is
 * given, so a seeded one gives the same day.
 */

export type BreakKind = 'cooler' | 'coffee' | 'vending' | 'smoke';

/** What a route is for: the Lounge, a break, lunch in the café, or posting a capsule at the tube station. */
export type RouteKind = 'lounge' | BreakKind | 'lunch' | 'tube';

export const BREAK_KINDS: readonly BreakKind[] = ['cooler', 'coffee', 'vending', 'smoke'];

/** Where a route is: walking to its target, at it, on the bar stool after the machine, or on a café seat after the buffet. */
export type RoutePhase = 'walking' | 'at' | 'bar' | 'seat';

export const PICK_MIN_SEC = 25;
export const PICK_MAX_SEC = 45;

/** The odds of a pick: the Lounge keeps half, the four breaks share the other half. */
export const PICK_WEIGHTS: Readonly<Record<'lounge' | BreakKind, number>> = {
  lounge: 50,
  cooler: 14,
  coffee: 14,
  vending: 10,
  smoke: 12,
};

export const SMOKE_CAP = 2;
export const SMOKE_COOLDOWN_SEC = 180;
export const SMOKE_MIN_SEC = 10;
export const SMOKE_MAX_SEC = 14;

export const COOLER_SEC = 4;
export const COFFEE_SEC = 4;
export const BAR_SEC = 8;
export const VENDING_SEC = 4;
export const BUFFET_SEC = 2.5;
/** How long a lead stands at the tube's front tile after posting its capsule. */
export const TUBE_SEC = 1;
/** How many leads queue for the tube at once: the front tile and two behind it. */
export const TUBE_QUEUE = 3;
/** A lead resting at the Lounge table at lunch looks again for a free café seat this often. */
export const LUNCH_RECHECK_SEC = 3;

/** Seconds to the next pick. */
export function pickDelay(rng: () => number): number {
  return PICK_MIN_SEC + rng() * (PICK_MAX_SEC - PICK_MIN_SEC);
}

/** How long a smoke lasts. */
export function smokeSeconds(rng: () => number): number {
  return SMOKE_MIN_SEC + rng() * (SMOKE_MAX_SEC - SMOKE_MIN_SEC);
}

/** Whether somebody may go for a smoke: fewer than two out there, and not itself within the last three minutes. */
export function smokeAllowed(smokers: number, lastAt: number | undefined, now: number): boolean {
  if (smokers >= SMOKE_CAP) return false;
  return lastAt === undefined || now - lastAt >= SMOKE_COOLDOWN_SEC;
}

/** Forgets the smokers whose cooldown is over (the map is by character id, so it must not grow). */
export function pruneCooldowns(smoked: Map<number, number>, now: number): void {
  for (const [id, at] of smoked) if (now - at >= SMOKE_COOLDOWN_SEC) smoked.delete(id);
}

/**
 * The next place: `'lounge'`, or one of the `can` breaks. A break that cannot be had (no free target, the smoking cap) is left out
 * of the draw, so the Lounge's share grows when the office is busy.
 */
export function pickRoutine(
  rng: () => number,
  can: Partial<Record<BreakKind, boolean>>,
): 'lounge' | BreakKind {
  const open = BREAK_KINDS.filter((k) => can[k] === true);
  let total = PICK_WEIGHTS.lounge;
  for (const k of open) total += PICK_WEIGHTS[k];
  let r = rng() * total;
  for (const k of open) {
    r -= PICK_WEIGHTS[k];
    if (r < 0) return k;
  }
  return 'lounge';
}

const FOOD = ['\u{1F35C}', '\u{1F957}'] as const;

/** The food bubble of a diner: a bowl or a salad, by its id. */
export function foodFor(id: number): string {
  return FOOD[Math.abs(id) % FOOD.length];
}
