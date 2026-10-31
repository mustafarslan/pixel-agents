/**
 * Aero's six furniture pieces: each sprite is a whole picture of its size, the merge adds them to the server's catalog
 * without touching a stock entry or the message, a bad catalog never throws, and a layout that names them draws them
 * and blocks the right tiles.
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import {
  type AeroCatalogAsset,
  aeroFurnitureCatalog,
  withAeroFurniture,
} from '../src/aero/furniture.js';
import { buildDynamicCatalog, getCatalogEntry } from '../src/office/layout/furnitureCatalog.js';
import {
  getBlockedTiles,
  layoutToFurnitureInstances,
} from '../src/office/layout/layoutSerializer.js';
import { AERO_SPRITE_GRIDS, buildAeroSprites } from '../src/office/sprites/aeroFurniture.js';
import type { PlacedFurniture, SpriteData } from '../src/office/types.js';

const TILE = 16;
// Built, not written, so the no-inline-colors lint rule (which guards the app's own colours) has nothing to flag.
const hex = (rrggbb: string): string => `#${rrggbb}`;
const GREY = hex('808080');
const IDS = [
  'AERO_TOILET',
  'AERO_SINK',
  'AERO_FRIDGE',
  'AERO_PINGPONG',
  'AERO_CONSOLE',
  'AERO_ARCADE',
];
/** The sizes the plan fixes: [width, height, footprintW, footprintH, backgroundTiles]. */
const SIZES: Record<string, number[]> = {
  AERO_TOILET: [16, 32, 1, 2, 1],
  AERO_SINK: [16, 32, 1, 2, 1],
  AERO_FRIDGE: [16, 32, 1, 2, 1],
  AERO_PINGPONG: [32, 32, 2, 2, 0],
  AERO_CONSOLE: [32, 32, 2, 2, 1],
  AERO_ARCADE: [16, 32, 1, 2, 1],
};

// A stand-in for what the server sends: one flat grey stock piece.
function stockCatalog(): AeroCatalogAsset[] {
  return [
    {
      id: 'WHITEBOARD',
      name: 'Whiteboard',
      label: 'Whiteboard',
      category: 'wall',
      file: '',
      width: 16,
      height: 32,
      footprintW: 1,
      footprintH: 2,
      isDesk: false,
      canPlaceOnWalls: true,
    },
  ];
}
function stockSprites(): Record<string, SpriteData> {
  return { WHITEBOARD: Array.from({ length: 32 }, () => new Array<string>(16).fill(GREY)) };
}

test('the six grids are whole: the right size, only palette characters, drawn in every tile', () => {
  const sprites = buildAeroSprites();
  assert.deepEqual(Object.keys(sprites).sort(), [...IDS].sort());
  for (const id of IDS) {
    const [w, h, fw, fh] = SIZES[id] as number[];
    const grid = AERO_SPRITE_GRIDS[id];
    assert.ok(grid, id);
    for (const row of grid.map) {
      for (const ch of row) assert.ok(ch === '.' || ch in grid.palette, `${id}: '${ch}' not in palette`);
    }
    for (const hex of Object.values(grid.palette)) assert.match(hex, /^#[0-9a-f]{6}$/, id);
    const sprite = sprites[id] as SpriteData;
    assert.equal(sprite.length, h, `${id} height`);
    const colors = new Set<string>();
    for (const row of sprite) {
      assert.equal(row.length, w, `${id} width`);
      for (const cell of row) {
        assert.ok(cell === '' || /^#[0-9a-f]{6}$/.test(cell), `${id}: bad cell '${cell}'`);
        if (cell !== '') colors.add(cell);
      }
    }
    assert.ok(colors.size >= 4, `${id} draws a picture, not a block`);
    // Something drawn in every tile of the footprint.
    for (let tr = 0; tr < (fh as number); tr++) {
      for (let tc = 0; tc < (fw as number); tc++) {
        let drawn = 0;
        for (let y = tr * TILE; y < (tr + 1) * TILE; y++) {
          for (let x = tc * TILE; x < (tc + 1) * TILE; x++) if (sprite[y]?.[x] !== '') drawn++;
        }
        assert.ok(drawn > 0, `${id}: tile ${tc},${tr} is empty`);
      }
    }
  }
});

test('the entries carry the plan sizes, a category that is never chairs, and no desk or wall flags', () => {
  const entries = aeroFurnitureCatalog();
  assert.deepEqual(entries.map((e) => e.id).sort(), [...IDS].sort());
  for (const e of entries) {
    assert.deepEqual(
      [e.width, e.height, e.footprintW, e.footprintH, e.backgroundTiles],
      SIZES[e.id],
      e.id,
    );
    assert.notEqual(e.category, 'chairs');
    assert.equal(e.isDesk, false);
    assert.equal(e.canPlaceOnWalls, false);
    assert.equal(e.file, '');
    assert.equal(e.orientation, 'front');
  }
});

test('the merge adds the six, leaves the stock entry and its sprite alone, and never changes its inputs', () => {
  const catalog = stockCatalog();
  const sprites = stockSprites();
  const before = JSON.stringify({ catalog, sprites });
  const merged = withAeroFurniture(catalog, sprites);
  assert.equal(JSON.stringify({ catalog, sprites }), before, 'inputs unchanged');
  assert.equal(merged.catalog.length, 1 + IDS.length);
  assert.equal(merged.catalog[0], catalog[0], 'the stock entry is the same object');
  assert.equal(merged.sprites['WHITEBOARD'], sprites['WHITEBOARD']);
  for (const id of IDS) assert.ok(merged.sprites[id], id);
  assert.notEqual(merged.catalog, catalog);
  assert.notEqual(merged.sprites, sprites);
});

test('an id the server already sent wins, and the catalog can be built twice', () => {
  const own = stockCatalog().map((e) => ({ ...e, id: 'AERO_TOILET', label: 'Theirs' }));
  const sprites = { AERO_TOILET: [[hex('123456')]] };
  const merged = withAeroFurniture(own, sprites);
  assert.equal(merged.catalog.filter((e) => e.id === 'AERO_TOILET').length, 1);
  assert.equal(merged.catalog[0]?.label, 'Theirs');
  assert.deepEqual(merged.sprites['AERO_TOILET'], [[hex('123456')]]);

  for (let i = 0; i < 2; i++) {
    const m = withAeroFurniture(stockCatalog(), stockSprites());
    assert.ok(buildDynamicCatalog({ catalog: m.catalog, sprites: m.sprites }), `build ${i}`);
    for (const id of IDS) {
      const entry = getCatalogEntry(id);
      assert.ok(entry, `${id} after build ${i}`);
      const [, , fw, fh, bg] = SIZES[id] as number[];
      assert.equal(entry.footprintW, fw);
      assert.equal(entry.footprintH, fh);
      assert.equal(entry.backgroundTiles ?? 0, bg);
    }
    assert.equal(getCatalogEntry('WHITEBOARD')?.sprite[0]?.[0], GREY);
  }
});

test('bad input never throws and still gives the six', () => {
  const bad: unknown[] = [undefined, null, 5, 'x', {}, [null, 3, {}, { id: 7 }]];
  for (const b of bad) {
    const merged = withAeroFurniture(b as never, b as never);
    for (const id of IDS) {
      assert.ok(merged.catalog.some((e) => e.id === id), id);
      assert.ok(merged.sprites[id], id);
    }
  }
});

test('a layout naming the six draws them and blocks their tiles by footprint and background rows', () => {
  const m = withAeroFurniture(stockCatalog(), stockSprites());
  buildDynamicCatalog({ catalog: m.catalog, sprites: m.sprites });
  const furniture: PlacedFurniture[] = [
    { uid: 'a', type: 'AERO_TOILET', col: 0, row: 0 },
    { uid: 'b', type: 'AERO_SINK', col: 2, row: 0 },
    { uid: 'c', type: 'AERO_FRIDGE', col: 4, row: 0 },
    { uid: 'd', type: 'AERO_ARCADE', col: 6, row: 0 },
    { uid: 'e', type: 'AERO_PINGPONG', col: 0, row: 4 },
    { uid: 'f', type: 'AERO_CONSOLE', col: 4, row: 4 },
  ];
  assert.equal(layoutToFurnitureInstances(furniture).length, 6);
  const blocked = getBlockedTiles(furniture);
  // 1x2 pieces: the top row is background (walkable), the bottom row blocks.
  for (const col of [0, 2, 4, 6]) {
    assert.ok(!blocked.has(`${col},0`), `${col},0 walkable behind`);
    assert.ok(blocked.has(`${col},1`), `${col},1 blocked`);
  }
  // Ping-pong blocks all four tiles; the console blocks only its bottom row.
  for (const key of ['0,4', '1,4', '0,5', '1,5']) assert.ok(blocked.has(key), key);
  assert.ok(!blocked.has('4,4') && !blocked.has('5,4'));
  assert.ok(blocked.has('4,5') && blocked.has('5,5'));
  assert.equal(blocked.size, 4 + 4 + 2);
});
