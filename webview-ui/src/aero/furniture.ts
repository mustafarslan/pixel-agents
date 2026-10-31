/**
 * Aero's six extra pieces for the big office: a toilet, a sink with a mirror, a fridge, a ping-pong table, a TV with a
 * games console, and an arcade cabinet. The stock server (1.5.0) sends its own furniture and knows none of them, so
 * they live in the page and are merged into the catalog at the one place the page receives it (`furnitureAssetsLoaded`).
 *
 * Sizes follow the renderer, which draws a sprite from its row downward: a 16x32 piece is 1x2 tiles with the top tile
 * a background tile (walkable behind it), as PLANT is. Every id starts `AERO_`; an incoming entry with the same id wins.
 */

import { buildAeroSprites } from '../office/sprites/aeroFurniture.js';
import type { SpriteData } from '../office/types.js';

/** The catalog row the page builds its furniture from (the shape the server sends). */
export interface AeroCatalogAsset {
  id: string;
  name: string;
  label: string;
  category: string;
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
}

function piece(
  id: string,
  label: string,
  category: string,
  width: number,
  height: number,
  footprintW: number,
  footprintH: number,
  backgroundTiles: number,
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
    canPlaceOnSurfaces: false,
    backgroundTiles,
    orientation: 'front',
  };
}

/** The six entries. Fresh objects each call, so a caller can't change the next one's. */
export function aeroFurnitureCatalog(): AeroCatalogAsset[] {
  return [
    piece('AERO_TOILET', 'Toilet', 'misc', 16, 32, 1, 2, 1),
    piece('AERO_SINK', 'Sink', 'misc', 16, 32, 1, 2, 1),
    piece('AERO_FRIDGE', 'Fridge', 'storage', 16, 32, 1, 2, 1),
    piece('AERO_PINGPONG', 'Ping-pong table', 'misc', 32, 32, 2, 2, 0),
    piece('AERO_CONSOLE', 'TV and console', 'electronics', 32, 32, 2, 2, 1),
    piece('AERO_ARCADE', 'Arcade cabinet', 'electronics', 16, 32, 1, 2, 1),
  ];
}

/**
 * The server's catalog and sprites with Aero's six added. Never mutates its inputs, never throws on bad ones (a
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
    sprites !== null && typeof sprites === 'object' ? sprites : {};
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
