/**
 * Aero's twenty-three extra pieces for the big office: a toilet, a sink with a mirror, a fridge, a ping-pong table, a TV with
 * a games console, an arcade cabinet, a water cooler, a pod whiteboard, a flower pot (placeable on desks), a coffee
 * machine, a buffet counter, a vending machine, a security desk, a turnstile, two railing sections, an ashtray stand, a lift (two doors with a floor indicator), a tube station (a pneumatic post on a wall), and the separators: a frosted glass partition and a planter divider, each with a side view. The stock server (1.5.0) sends its own furniture and knows none of them, so
 * they live in the page and are merged into the catalog at the one place the page receives it (`furnitureAssetsLoaded`).
 *
 * None is `electronics`: the stock seat picker treats that category as a PC and prefers a seat facing one, so agents would
 * type on the games sofa. None is `chairs` or `desks` for the same kind of reason.
 *
 * Sizes follow the renderer, which draws a sprite from its row downward: a 16x32 piece is 1x2 tiles with the top tile
 * a background tile (walkable behind it), as PLANT is. Every id starts `AERO_`; an incoming entry with the same id wins.
 */

import type { FurnitureCategory } from '../office/layout/furnitureCatalog.js';
import { buildAeroSprites } from '../office/sprites/aeroFurniture.js';
import type { SpriteData } from '../office/types.js';

/** The catalog row the page builds its furniture from (the shape the server sends). */
export interface AeroCatalogAsset {
  id: string;
  name: string;
  label: string;
  category: FurnitureCategory;
  file: string;
  width: number;
  height: number;
  footprintW: number;
  footprintH: number;
  isDesk: boolean;
  canPlaceOnWalls: boolean;
  canPlaceOnSurfaces?: boolean;
  backgroundTiles?: number;
  orientation?: string;
  groupId?: string;
  rotationScheme?: string;
}

function piece(
  id: string,
  label: string,
  category: FurnitureCategory,
  width: number,
  height: number,
  footprintW: number,
  footprintH: number,
  backgroundTiles: number,
  canPlaceOnSurfaces = false,
  rotation?: { groupId: string; orientation: string },
): AeroCatalogAsset {
  return {
    id,
    name: label,
    label,
    category,
    file: '',
    width,
    height,
    footprintW,
    footprintH,
    isDesk: false,
    canPlaceOnWalls: false,
    canPlaceOnSurfaces,
    backgroundTiles,
    orientation: rotation?.orientation ?? 'front',
    ...(rotation ? { groupId: rotation.groupId, rotationScheme: '2-way' } : {}),
  };
}

/** The twenty-three entries. Fresh objects each call, so a caller can't change the next one's. */
export function aeroFurnitureCatalog(): AeroCatalogAsset[] {
  return [
    piece('AERO_TOILET', 'Toilet', 'misc', 16, 32, 1, 2, 1),
    piece('AERO_SINK', 'Sink', 'misc', 16, 32, 1, 2, 1),
    piece('AERO_FRIDGE', 'Fridge', 'storage', 16, 32, 1, 2, 1),
    piece('AERO_PINGPONG', 'Ping-pong table', 'misc', 32, 32, 2, 2, 0),
    piece('AERO_CONSOLE', 'TV and console', 'decor', 32, 32, 2, 2, 1),
    piece('AERO_ARCADE', 'Arcade cabinet', 'decor', 16, 32, 1, 2, 1),
    piece('AERO_WATERCOOLER', 'Water cooler', 'misc', 16, 32, 1, 2, 1),
    piece('AERO_POD_WHITEBOARD', 'Pod whiteboard', 'decor', 16, 32, 1, 2, 1),
    // The only piece that sits on a desk's front row; blocks nothing of its own.
    piece('AERO_FLOWER_POT', 'Flower pot', 'decor', 16, 16, 1, 1, 0, true),
    piece('AERO_COFFEE_MACHINE', 'Coffee machine', 'misc', 16, 32, 1, 2, 1),
    piece('AERO_BUFFET_COUNTER', 'Buffet counter', 'misc', 32, 32, 2, 2, 1),
    piece('AERO_VENDING_MACHINE', 'Vending machine', 'misc', 16, 32, 1, 2, 1),
    piece('AERO_SECURITY_DESK', 'Security desk', 'misc', 32, 32, 2, 2, 1),
    piece('AERO_TURNSTILE', 'Turnstile', 'misc', 16, 32, 1, 2, 1),
    // The two railings are one 2-way rotation group, as the stock desk is: the editor shows the front one, and rotating it
    // gives the side one (for vertical runs).
    piece('AERO_BALCONY_RAILING', 'Balcony railing', 'decor', 16, 16, 1, 1, 0, false, {
      groupId: 'AERO_BALCONY_RAILING',
      orientation: 'front',
    }),
    piece('AERO_BALCONY_RAILING_SIDE', 'Balcony railing (side)', 'decor', 16, 16, 1, 1, 0, false, {
      groupId: 'AERO_BALCONY_RAILING',
      orientation: 'side',
    }),
    piece('AERO_ASHTRAY_STAND', 'Ashtray stand', 'misc', 16, 32, 1, 2, 1),
    piece('AERO_ELEVATOR', 'Lift', 'misc', 32, 32, 2, 2, 1),
    // The separators: two more 2-way groups, as the railings are. The front piece is in the editor palette, the side one is
    // reached by rotating it. 1x2 tiles with the top tile a background one, so only the lower tile blocks.
    piece('AERO_GLASS_PARTITION', 'Glass partition', 'decor', 16, 32, 1, 2, 1, false, {
      groupId: 'AERO_GLASS_PARTITION',
      orientation: 'front',
    }),
    piece('AERO_GLASS_PARTITION_SIDE', 'Glass partition (side)', 'decor', 16, 32, 1, 2, 1, false, {
      groupId: 'AERO_GLASS_PARTITION',
      orientation: 'side',
    }),
    piece('AERO_PLANTER_DIVIDER', 'Planter divider', 'decor', 16, 32, 1, 2, 1, false, {
      groupId: 'AERO_PLANTER_DIVIDER',
      orientation: 'front',
    }),
    piece('AERO_PLANTER_DIVIDER_SIDE', 'Planter divider (side)', 'decor', 16, 32, 1, 2, 1, false, {
      groupId: 'AERO_PLANTER_DIVIDER',
      orientation: 'side',
    }),
    // The only piece that hangs on a wall (the meeting room's): its two tiles are wall, and its front tile is where a lead posts.
    {
      ...piece('AERO_TUBE_STATION', 'Tube station', 'decor', 16, 32, 1, 2, 0),
      canPlaceOnWalls: true,
    },
  ];
}

/**
 * The server's catalog and sprites with Aero's twenty-three added. Never mutates its inputs, never throws on bad ones (a
 * missing or malformed catalog or sprite map counts as empty, and a malformed entry is dropped), and an id the server already sent is left as it is.
 */
export function withAeroFurniture<C extends { id: string }>(
  catalog: readonly C[] | null | undefined,
  sprites: Record<string, SpriteData> | null | undefined,
): { catalog: Array<C | AeroCatalogAsset>; sprites: Record<string, SpriteData> } {
  // An entry that isn't an object with a string id would break the page's catalog build, so it is dropped.
  const incoming: C[] = (Array.isArray(catalog) ? (catalog as readonly C[]) : []).filter(
    (entry) => entry !== null && typeof entry === 'object' && typeof entry.id === 'string',
  );
  const incomingSprites: Record<string, SpriteData> =
    sprites !== null && typeof sprites === 'object' && !Array.isArray(sprites) ? sprites : {};
  // A catalog with no entry the page can build (none has a sprite) is not a catalog: it is returned as it is, so the page's
  // build fails and keeps the previous catalog instead of replacing it with Aero's pieces alone.
  if (!incoming.some((entry) => Array.isArray(incomingSprites[entry.id]))) {
    return { catalog: incoming, sprites: incomingSprites };
  }
  const taken = new Set<string>(incoming.map((entry) => entry.id));
  const mergedCatalog: Array<C | AeroCatalogAsset> = [...incoming];
  const mergedSprites: Record<string, SpriteData> = { ...incomingSprites };
  const own = buildAeroSprites();
  for (const entry of aeroFurnitureCatalog()) {
    if (taken.has(entry.id)) continue;
    const sprite = own[entry.id];
    if (!sprite) continue;
    mergedCatalog.push(entry);
    mergedSprites[entry.id] = sprite;
  }
  return { catalog: mergedCatalog, sprites: mergedSprites };
}
