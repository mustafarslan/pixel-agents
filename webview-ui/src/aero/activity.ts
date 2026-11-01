/**
 * What a subagent does at work, told by its type. The page never sees a stock subagent's own tools (they reach it as its lead's), so the
 * type is all there is: a fixed table, matched on the lower-cased name. The type's own text is never shown, and never drawn: only the
 * table's bubble is.
 */
import type { StationGroup } from './stations.js';

export type Activity = 'type' | 'read' | 'plan' | 'review';

/** The bubble over a subagent at work: from this table only. */
export const ACTIVITY_BUBBLE: Record<Activity, string> = {
  type: '\u{1F4BB}',
  read: '\u{1F4D6}',
  plan: '\u{1F4CB}',
  review: '\u{1F50D}',
};

/** The dots over a person whose subagent waits for permission (the stock subagent's own are drawn by the tool overlay). */
export const PERMISSION_BUBBLE = '...';

/** Only this much of a type's name is looked at. */
const TYPE_LOOKED_AT = 80;

/** The first match wins: reading and research, then planning and design, then review; the rest type. */
export function activityOf(type: string): Activity {
  const t = type.slice(0, TYPE_LOOKED_AT).toLowerCase();
  if (t.includes('explore') || t.includes('research') || t.includes('search')) return 'read';
  if (t === 'plan' || t.includes('planner') || t.includes('architect') || t.includes('design'))
    return 'plan';
  if (t.includes('review')) return 'review';
  return 'type';
}

/** Whether the activity uses the reading sprite. */
export const readsAt = (a: Activity): boolean => a === 'read' || a === 'review';

const AT_A_PC: StationGroup[] = ['pc', 'focus', 'hot', 'library', 'meeting'];

/**
 * The station groups an activity tries, in order. The pod's bottom benches face the hall with no desk and are for waiting, not work.
 */
export function chainOf(a: Activity): StationGroup[] {
  switch (a) {
    case 'read':
      return ['library', 'shelf', 'pc', 'focus', 'hot', 'meeting'];
    case 'plan':
      return ['whiteboard', ...AT_A_PC];
    default:
      return AT_A_PC;
  }
}
