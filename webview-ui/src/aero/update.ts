/**
 * The data Aero (the host app) pushes into the page: `window.aeroOffice.update(data)`.
 *
 * It is untrusted text (agent names, a meeting title), so it is validated strictly: exactly these keys, exactly these
 * types and caps. Anything else is rejected whole, and the page keeps the last update it accepted. The page draws
 * these strings with canvas `fillText` only, never as HTML.
 *
 * The exact JSON (`pods` is the open office's live pod data and `floor` the floor on show; both are optional, and `null`
 * means the same as absent):
 *
 *   {
 *     "lunch": false,
 *     "meeting": { "time": "14:30", "title": "Design review", "soon": false } | null,
 *     "inbox": 3,
 *     "agents": [ { "name": "Code Reviewer", "slug": "code-reviewer", "floor": "<12 hex>"? | "room": "<12 hex>"? } ],
 *     "lounge": true,
 *     "pods": {
 *       "mappings": { "<directoryName>": ["Pod 1"], "<directoryName>": ["Hot desks"], ... },
 *       "labels":   { "Pod 1": { "name": "feat-auth", "dim": false }, "Pod 2": { "name": "", "dim": true }, ... }
 *     },
 *     "floor": { "id": "<12 hex>", "number": 2, "name": "web", "rooms": ["<12 hex>" | "prruns", ...] }
 *   }
 *
 * - `mappings`: at most 32 keys (14 worktrees and the fixed ones); a key is a directory name (1..40 characters), its value
 *   1..4 area labels (1..40 characters each, no duplicates). The page uses them as its slug to area mappings while an
 *   accepted update carries them.
 * - `labels`: at most 16 keys, each an area label (1..40 characters). `name` is what the pod is drawn with (0..40
 *   characters; empty means a pod with no worktree: no text), `dim` whether it has no live Claude (drawn dimmed).
 * - `floor`: the one floor on show (one per repo; its bar and the other floors stay in Aero). `id` is 12 hex, `number` 1..16,
 *   `name` 1..32 characters, `rooms` at most 64 distinct directory names (12 hex, or `prruns`, which is on every floor). A
 *   character whose directory name is not in `rooms` (and its subagents and teammates) is not on this floor: hidden, with no seat.
 * - `agents`: a project agent has the `floor` (the repo's floor id) it is staff of, or, with no floor (Rooms style, no repo),
 *   the `room` of its worktree; never both. The owner's have neither: one shared set, on the floor on show unless its roster
 *   has the type. At most 16 a floor, 16 for the rooms, 16 of the owner's, 272 in all; a slug once per floor, room or owner.
 * - Strings have no control, format or line-separator characters. Keys are exactly these; nothing else is accepted.
 */

/** Everything an update carries: 16 floors of 16, and the owner's 16 once. */
export const MAX_AGENTS = 272;
/** Staff of one floor, the agents of the rooms in all, and the owner's. A floor shows 16 in all, its own first. */
export const MAX_AGENTS_PER_FLOOR = 16;
export const MAX_AGENT_ROOMS = 16;
export const MAX_OWNER_AGENTS = 16;
export const MAX_NAME_CHARS = 40;
export const MAX_TITLE_CHARS = 60;
export const MAX_INBOX = 99_999;
/** Pod data: 14 worktrees and the fixed ones. */
export const MAX_POD_MAPPINGS = 32;
export const MAX_AREAS_PER_MAPPING = 4;
export const MAX_POD_LABELS = 16;
export const MAX_LABEL_CHARS = 40;
/** Floors: one per repo, at most 16; the update carries the one on show. */
export const MAX_FLOORS = 16;
export const MAX_FLOOR_NAME_CHARS = 32;
export const MAX_FLOOR_ROOMS = 64;
/** The shared stub folder of the PR runs, which are on every floor. */
export const PR_RUNS_ROOM = 'prruns';

export interface AeroAgent {
  /** What the character is labelled with. */
  name: string;
  /** What a SubagentStart's `agent_type` must equal, exactly. */
  slug: string;
  /**
   * The worktree's room (its slug, the stub folder name) for a project agent with no floor: it is matched only for a lead whose
   * `directoryName` is this. Absent for the owner's agents, which match any lead.
   */
  room?: string;
  /** The repo's floor id for a project agent: it is staff of that floor, and on it only. Never with a room. */
  floor?: string;
}

export interface AeroMeeting {
  /** "HH:MM", on the Mac's clock. */
  time: string;
  title: string;
  /** Whether it starts within five minutes (Aero decides: the page has no clock of its own). */
  soon: boolean;
}

export interface AeroPodLabel {
  /** What the pod is drawn with; empty for a pod with no worktree (no text). */
  name: string;
  /** No live Claude in this pod: drawn dimmed. */
  dim: boolean;
}

export interface AeroPods {
  /** directoryName to the area labels it sits in. */
  mappings: Record<string, string[]>;
  /** Area label to what is drawn there. */
  labels: Record<string, AeroPodLabel>;
}

export interface AeroFloor {
  /** The repo's floor id (12 hex). */
  id: string;
  /** 1..16, the floor's place in the bar ("2F"). */
  number: number;
  /** The repo's name. */
  name: string;
  /** The directory names on this floor. */
  rooms: string[];
}

export interface AeroUpdate {
  /** True from 12:00 to 13:00 by the Mac's clock (Aero computes it: the page has no clock of its own). */
  lunch: boolean;
  meeting: AeroMeeting | null;
  inbox: number;
  agents: AeroAgent[];
  /** Whether the layout has Aero's Lounge. */
  lounge: boolean;
  /** The open office's live pods. Absent when the update carries none. */
  pods?: AeroPods;
  /** The floor on show. Absent when the update carries none: everyone is on the floor. */
  floor?: AeroFloor;
}

const KEYS = ['agents', 'inbox', 'lounge', 'lunch', 'meeting'];
const OPTIONAL_KEYS = ['floor', 'pods'];
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ROOM_RE = /^[0-9a-f]{12}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Control, format (bidi marks too), and line or paragraph separator characters. */
const FORBIDDEN_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Whether `value` has every key of `required` and no key that isn't in `required` or `optional`. */
function hasKeysAmong(
  value: Record<string, unknown>,
  required: string[],
  optional: string[],
): boolean {
  const own = Object.keys(value);
  return (
    required.every((key) => own.includes(key)) &&
    own.every((key) => required.includes(key) || optional.includes(key))
  );
}

function hasKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const own = Object.keys(value).sort();
  return own.length === keys.length && own.every((key, i) => key === keys[i]);
}

/** A string of 1..max characters (code points) with nothing forbidden in it, and not blank. */
function cleanText(value: unknown, max: number, allowEmpty = false): string | null {
  if (typeof value !== 'string') return null;
  if (FORBIDDEN_RE.test(value)) return null;
  const length = Array.from(value).length;
  if (length > max) return null;
  if (!allowEmpty && value.trim().length === 0) return null;
  return value;
}

/** The pod data, or null when it isn't exactly the shape above. */
function parsePods(raw: unknown): AeroPods | null {
  if (!isPlainObject(raw) || !hasKeys(raw, ['labels', 'mappings'])) return null;
  const { mappings, labels } = raw;
  if (!isPlainObject(mappings) || !isPlainObject(labels)) return null;
  const mappingKeys = Object.keys(mappings);
  const labelKeys = Object.keys(labels);
  if (mappingKeys.length > MAX_POD_MAPPINGS || labelKeys.length > MAX_POD_LABELS) return null;

  const parsedMappings: Record<string, string[]> = {};
  for (const key of mappingKeys) {
    if (key === '__proto__' || cleanText(key, MAX_LABEL_CHARS) === null) return null;
    const value = mappings[key];
    if (!Array.isArray(value) || value.length < 1 || value.length > MAX_AREAS_PER_MAPPING) {
      return null;
    }
    const areas: string[] = [];
    for (const area of value) {
      const text = cleanText(area, MAX_LABEL_CHARS);
      if (text === null || areas.includes(text)) return null;
      areas.push(text);
    }
    parsedMappings[key] = areas;
  }

  const parsedLabels: Record<string, AeroPodLabel> = {};
  for (const key of labelKeys) {
    if (key === '__proto__' || cleanText(key, MAX_LABEL_CHARS) === null) return null;
    const entry = labels[key];
    if (!isPlainObject(entry) || !hasKeys(entry, ['dim', 'name'])) return null;
    if (typeof entry.dim !== 'boolean') return null;
    const name = cleanText(entry.name, MAX_LABEL_CHARS, true);
    if (name === null) return null;
    parsedLabels[key] = { name, dim: entry.dim };
  }
  return { mappings: parsedMappings, labels: parsedLabels };
}

/** The floor, or null when it isn't exactly the shape above. */
function parseFloor(raw: unknown): AeroFloor | null {
  if (!isPlainObject(raw) || !hasKeys(raw, ['id', 'name', 'number', 'rooms'])) return null;
  const { id, number, name, rooms } = raw;
  if (typeof id !== 'string' || !ROOM_RE.test(id)) return null;
  if (
    typeof number !== 'number' ||
    !Number.isInteger(number) ||
    number < 1 ||
    number > MAX_FLOORS
  ) {
    return null;
  }
  const text = cleanText(name, MAX_FLOOR_NAME_CHARS);
  if (text === null) return null;
  if (!Array.isArray(rooms) || rooms.length > MAX_FLOOR_ROOMS) return null;
  const seen = new Set<string>();
  for (const room of rooms) {
    if (typeof room !== 'string' || !(ROOM_RE.test(room) || room === PR_RUNS_ROOM)) return null;
    if (seen.has(room)) return null;
    seen.add(room);
  }
  return { id, number, name: text, rooms: [...rooms] as string[] };
}

/** The update, or null when it isn't exactly the shape above. */
export function parseAeroUpdate(raw: unknown): AeroUpdate | null {
  if (!isPlainObject(raw)) return null;
  if (!hasKeysAmong(raw, KEYS, OPTIONAL_KEYS)) return null;
  const { lunch, lounge, inbox, meeting, agents } = raw;
  let pods: AeroPods | null = null;
  if ('pods' in raw && raw.pods !== null) {
    pods = parsePods(raw.pods);
    if (pods === null) return null;
  }
  let floor: AeroFloor | null = null;
  if ('floor' in raw && raw.floor !== null) {
    floor = parseFloor(raw.floor);
    if (floor === null) return null;
  }
  if (typeof lunch !== 'boolean' || typeof lounge !== 'boolean') return null;
  if (typeof inbox !== 'number' || !Number.isInteger(inbox) || inbox < 0 || inbox > MAX_INBOX) {
    return null;
  }

  let parsedMeeting: AeroMeeting | null = null;
  if (meeting !== null) {
    if (!isPlainObject(meeting) || !hasKeys(meeting, ['soon', 'time', 'title'])) return null;
    if (typeof meeting.time !== 'string' || !TIME_RE.test(meeting.time)) return null;
    if (typeof meeting.soon !== 'boolean') return null;
    const title = cleanText(meeting.title, MAX_TITLE_CHARS, true);
    if (title === null) return null;
    parsedMeeting = { time: meeting.time, title, soon: meeting.soon };
  }

  if (!Array.isArray(agents) || agents.length > MAX_AGENTS) return null;
  const parsedAgents: AeroAgent[] = [];
  const seen = new Set<string>();
  const perFloor = new Map<string, number>();
  let inRooms = 0;
  let owners = 0;
  for (const agent of agents) {
    if (!isPlainObject(agent)) return null;
    const keys = Object.keys(agent).sort();
    const place = keys.includes('floor') ? 'floor' : keys.includes('room') ? 'room' : null;
    const expected = place === null ? ['name', 'slug'] : [...['name', 'slug', place]].sort();
    if (keys.length !== expected.length || !keys.every((k, i) => k === expected[i])) return null;
    const name = cleanText(agent.name, MAX_NAME_CHARS);
    if (name === null) return null;
    if (typeof agent.slug !== 'string' || !SLUG_RE.test(agent.slug)) return null;
    const where = place === null ? null : agent[place];
    if (place !== null && (typeof where !== 'string' || !ROOM_RE.test(where))) return null;
    // One character per slug and floor (or room, or owner): a project's agent is staff of its floor.
    const id = `${place ?? ''}:${where ?? ''}/${agent.slug}`;
    if (seen.has(id)) return null;
    seen.add(id);
    if (place === 'floor') {
      const count = (perFloor.get(where as string) ?? 0) + 1;
      if (count > MAX_AGENTS_PER_FLOOR) return null;
      perFloor.set(where as string, count);
    } else if (place === 'room') {
      if (++inRooms > MAX_AGENT_ROOMS) return null;
    } else if (++owners > MAX_OWNER_AGENTS) {
      return null;
    }
    parsedAgents.push(
      place === 'floor'
        ? { name, slug: agent.slug, floor: where as string }
        : place === 'room'
          ? { name, slug: agent.slug, room: where as string }
          : { name, slug: agent.slug },
    );
  }
  if (perFloor.size > MAX_FLOORS) return null;

  const update: AeroUpdate = {
    lunch,
    meeting: parsedMeeting,
    inbox,
    agents: parsedAgents,
    lounge,
  };
  if (pods !== null) update.pods = pods;
  if (floor !== null) update.floor = floor;
  return update;
}

/**
 * `Subtask: <agent_type>` (the status the server sends with a hook-made subagent), or null. A subagent with no type comes as
 * `Subtask: unknown` from the server (hookEventHandler.ts), which is no type either: an agent named `unknown` is never matched.
 */
export function agentTypeFromStatus(status: unknown): string | null {
  if (typeof status !== 'string' || !status.startsWith('Subtask:')) return null;
  const type = status.slice('Subtask:'.length).trim();
  return type.length > 0 && type !== 'unknown' ? type : null;
}

/** Counts shown on a badge: 1..99, then "99+". */
export function badgeText(count: number): string {
  return count > 99 ? '99+' : String(count);
}

/** Text cut to `max` characters, with an ellipsis when it was cut. */
export function clip(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, Math.max(0, max - 1)).join('') + '…';
}
