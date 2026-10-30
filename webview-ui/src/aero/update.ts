/**
 * The data Aero (the host app) pushes into the page: `window.aeroOffice.update(data)`.
 *
 * It is untrusted text (agent names, a meeting title), so it is validated strictly: exactly these keys, exactly these
 * types and caps. Anything else is rejected whole, and the page keeps the last update it accepted. The page draws
 * these strings with canvas `fillText` only, never as HTML.
 */

export const MAX_AGENTS = 8;
export const MAX_NAME_CHARS = 40;
export const MAX_TITLE_CHARS = 60;
export const MAX_INBOX = 99_999;

export interface AeroAgent {
  /** What the character is labelled with. */
  name: string;
  /** What a SubagentStart's `agent_type` must equal, exactly. */
  slug: string;
  /**
   * The worktree's room (its slug, the stub folder name) for a project agent: it is matched only for a lead whose
   * `directoryName` is this. Absent for the owner's agents, which match any lead.
   */
  room?: string;
}

export interface AeroMeeting {
  /** "HH:MM", on the Mac's clock. */
  time: string;
  title: string;
}

export interface AeroUpdate {
  /** True from 12:00 to 13:00 by the Mac's clock (Aero computes it: the page has no clock of its own). */
  lunch: boolean;
  meeting: AeroMeeting | null;
  inbox: number;
  agents: AeroAgent[];
  /** Whether the layout has Aero's Lounge. */
  lounge: boolean;
}

const KEYS = ['agents', 'inbox', 'lounge', 'lunch', 'meeting'];
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

/** The update, or null when it isn't exactly the shape above. */
export function parseAeroUpdate(raw: unknown): AeroUpdate | null {
  if (!isPlainObject(raw) || !hasKeys(raw, KEYS)) return null;
  const { lunch, lounge, inbox, meeting, agents } = raw;
  if (typeof lunch !== 'boolean' || typeof lounge !== 'boolean') return null;
  if (typeof inbox !== 'number' || !Number.isInteger(inbox) || inbox < 0 || inbox > MAX_INBOX) {
    return null;
  }

  let parsedMeeting: AeroMeeting | null = null;
  if (meeting !== null) {
    if (!isPlainObject(meeting) || !hasKeys(meeting, ['time', 'title'])) return null;
    if (typeof meeting.time !== 'string' || !TIME_RE.test(meeting.time)) return null;
    const title = cleanText(meeting.title, MAX_TITLE_CHARS, true);
    if (title === null) return null;
    parsedMeeting = { time: meeting.time, title };
  }

  if (!Array.isArray(agents) || agents.length > MAX_AGENTS) return null;
  const parsedAgents: AeroAgent[] = [];
  const seen = new Set<string>();
  for (const agent of agents) {
    if (!isPlainObject(agent)) return null;
    const withRoom = hasKeys(agent, ['name', 'room', 'slug']);
    if (!withRoom && !hasKeys(agent, ['name', 'slug'])) return null;
    const name = cleanText(agent.name, MAX_NAME_CHARS);
    if (name === null) return null;
    if (typeof agent.slug !== 'string' || !SLUG_RE.test(agent.slug)) return null;
    if (withRoom && (typeof agent.room !== 'string' || !ROOM_RE.test(agent.room))) return null;
    // One character per slug and room: a project's agent is in each of its worktrees.
    const id = `${withRoom ? agent.room : ''}/${agent.slug}`;
    if (seen.has(id)) return null;
    seen.add(id);
    parsedAgents.push(
      withRoom
        ? { name, slug: agent.slug, room: agent.room as string }
        : { name, slug: agent.slug },
    );
  }

  return { lunch, meeting: parsedMeeting, inbox, agents: parsedAgents, lounge };
}

/** `Subtask: <agent_type>` (the status the server sends with a hook-made subagent), or null. */
export function agentTypeFromStatus(status: unknown): string | null {
  if (typeof status !== 'string' || !status.startsWith('Subtask:')) return null;
  const type = status.slice('Subtask:'.length).trim();
  return type.length > 0 ? type : null;
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
