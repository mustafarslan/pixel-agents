import {
  NOTIFICATION_NOTE_1_HZ,
  NOTIFICATION_NOTE_1_START_SEC,
  NOTIFICATION_NOTE_2_HZ,
  NOTIFICATION_NOTE_2_START_SEC,
  NOTIFICATION_NOTE_DURATION_SEC,
  NOTIFICATION_VOLUME,
  PERMISSION_NOTE_1_HZ,
  PERMISSION_NOTE_1_START_SEC,
  PERMISSION_NOTE_2_HZ,
  PERMISSION_NOTE_2_START_SEC,
  PERMISSION_NOTE_DURATION_SEC,
  PERMISSION_VOLUME,
} from './constants.js';
import { isE2E } from './runtime.js';

let soundEnabled = true;
let audioCtx: AudioContext | null = null;

/** E2E test hook: append every (attempted) sound invocation to a window-side log
 *  under window.__pixelAgentsTestHooks.playedSounds (namespace and type
 *  declared by testHooks.ts). Records BEFORE the soundEnabled gate so tests
 *  verify dispatch independent of user audio prefs. Gated on the e2e harness
 *  flag so this unbounded log never grows in a real session. */
function recordSoundForTests(kind: 'done' | 'permission' | 'tube'): void {
  if (!isE2E || typeof window === 'undefined') return;
  // Typed here, not through testHooks.ts's global: the test projects compile this file (the office plays the tube's sound) without it.
  const w = window as unknown as {
    __pixelAgentsTestHooks?: { playedSounds?: Array<{ kind: string; at: number }> };
  };
  if (!w.__pixelAgentsTestHooks) w.__pixelAgentsTestHooks = {};
  if (!w.__pixelAgentsTestHooks.playedSounds) {
    w.__pixelAgentsTestHooks.playedSounds = [];
  }
  w.__pixelAgentsTestHooks.playedSounds.push({ kind, at: Date.now() });
}

export function setSoundEnabled(enabled: boolean): void {
  soundEnabled = enabled;
}

export function isSoundEnabled(): boolean {
  return soundEnabled;
}

function playNote(
  ctx: AudioContext,
  freq: number,
  startOffset: number,
  duration: number = NOTIFICATION_NOTE_DURATION_SEC,
  volume: number = NOTIFICATION_VOLUME,
): void {
  const t = ctx.currentTime + startOffset;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, t);

  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(t);
  osc.stop(t + duration);
}

export async function playDoneSound(): Promise<void> {
  recordSoundForTests('done');
  if (!soundEnabled) return;
  try {
    if (!audioCtx) {
      audioCtx = new AudioContext();
    }
    // Resume suspended context (webviews suspend until user gesture)
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }
    // Ascending two-note chime: E5 → B5
    playNote(audioCtx, NOTIFICATION_NOTE_1_HZ, NOTIFICATION_NOTE_1_START_SEC);
    playNote(audioCtx, NOTIFICATION_NOTE_2_HZ, NOTIFICATION_NOTE_2_START_SEC);
  } catch {
    // Audio may not be available
  }
}

export async function playPermissionSound(): Promise<void> {
  recordSoundForTests('permission');
  if (!soundEnabled) return;
  try {
    if (!audioCtx) {
      audioCtx = new AudioContext();
    }
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }
    // Descending two-note tap: A5 → E5
    playNote(
      audioCtx,
      PERMISSION_NOTE_1_HZ,
      PERMISSION_NOTE_1_START_SEC,
      PERMISSION_NOTE_DURATION_SEC,
      PERMISSION_VOLUME,
    );
    playNote(
      audioCtx,
      PERMISSION_NOTE_2_HZ,
      PERMISSION_NOTE_2_START_SEC,
      PERMISSION_NOTE_DURATION_SEC,
      PERMISSION_VOLUME,
    );
  } catch {
    // Audio may not be available
  }
}

// Aero's tube station: a short two-note whoosh, rising (D5 -> A5), softer than the permission tap.
const TUBE_NOTE_1_HZ = 587.33;
const TUBE_NOTE_2_HZ = 880;
const TUBE_NOTE_1_START_SEC = 0;
const TUBE_NOTE_2_START_SEC = 0.09;
const TUBE_NOTE_DURATION_SEC = 0.16;
const TUBE_VOLUME = 0.1;

/** The whoosh of a capsule posted at the tube station: recorded for the e2e tests like the others, silent with the sound switch off. */
export async function playTubeSound(): Promise<void> {
  recordSoundForTests('tube');
  if (!soundEnabled) return;
  try {
    if (!audioCtx) {
      audioCtx = new AudioContext();
    }
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }
    playNote(audioCtx, TUBE_NOTE_1_HZ, TUBE_NOTE_1_START_SEC, TUBE_NOTE_DURATION_SEC, TUBE_VOLUME);
    playNote(audioCtx, TUBE_NOTE_2_HZ, TUBE_NOTE_2_START_SEC, TUBE_NOTE_DURATION_SEC, TUBE_VOLUME);
  } catch {
    // Audio may not be available
  }
}

/** Call from any user-gesture handler to ensure AudioContext is unlocked */
export function unlockAudio(): void {
  try {
    if (!audioCtx) {
      audioCtx = new AudioContext();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  } catch {
    // ignore
  }
}
