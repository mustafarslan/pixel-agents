/**
 * Aero's twenty-three furniture pieces: each sprite is a whole picture of its size, the merge adds them to the server's catalog
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
import { canPlaceFurniture } from '../src/office/editor/editorActions.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import {
  buildDynamicCatalog,
  FURNITURE_CATEGORIES,
  getCatalogByCategory,
  getCatalogEntry,
  getRotatedType,
  isRotatable,
} from '../src/office/layout/furnitureCatalog.js';
import {
  getBlockedTiles,
  layoutToFurnitureInstances,
} from '../src/office/layout/layoutSerializer.js';
import { AERO_SPRITE_GRIDS, buildAeroSprites } from '../src/office/sprites/aeroFurniture.js';
import type { PlacedFurniture, SpriteData } from '../src/office/types.js';

const TILE = 16;
const GREY = '#808080';
const IDS = [
  'AERO_TOILET',
  'AERO_SINK',
  'AERO_FRIDGE',
  'AERO_PINGPONG',
  'AERO_CONSOLE',
  'AERO_ARCADE',
  'AERO_WATERCOOLER',
  'AERO_POD_WHITEBOARD',
  'AERO_FLOWER_POT',
  'AERO_COFFEE_MACHINE',
  'AERO_BUFFET_COUNTER',
  'AERO_VENDING_MACHINE',
  'AERO_SECURITY_DESK',
  'AERO_TURNSTILE',
  'AERO_BALCONY_RAILING',
  'AERO_BALCONY_RAILING_SIDE',
  'AERO_ASHTRAY_STAND',
  'AERO_ELEVATOR',
  'AERO_GLASS_PARTITION',
  'AERO_GLASS_PARTITION_SIDE',
  'AERO_PLANTER_DIVIDER',
  'AERO_PLANTER_DIVIDER_SIDE',
  'AERO_TUBE_STATION',
];
/** The category of each of the sixteen newer pieces. */
const CATEGORIES: Record<string, string> = {
  AERO_WATERCOOLER: 'misc',
  AERO_POD_WHITEBOARD: 'decor',
  AERO_FLOWER_POT: 'decor',
  AERO_COFFEE_MACHINE: 'misc',
  AERO_BUFFET_COUNTER: 'misc',
  AERO_VENDING_MACHINE: 'misc',
  AERO_SECURITY_DESK: 'misc',
  AERO_TURNSTILE: 'misc',
  AERO_BALCONY_RAILING: 'decor',
  AERO_BALCONY_RAILING_SIDE: 'decor',
  AERO_ASHTRAY_STAND: 'misc',
  AERO_ELEVATOR: 'misc',
  AERO_GLASS_PARTITION: 'decor',
  AERO_GLASS_PARTITION_SIDE: 'decor',
  AERO_PLANTER_DIVIDER: 'decor',
  AERO_PLANTER_DIVIDER_SIDE: 'decor',
};
/** The sizes the plan fixes: [width, height, footprintW, footprintH, backgroundTiles]. */
const SIZES: Record<string, number[]> = {
  AERO_TOILET: [16, 32, 1, 2, 1],
  AERO_SINK: [16, 32, 1, 2, 1],
  AERO_FRIDGE: [16, 32, 1, 2, 1],
  AERO_PINGPONG: [32, 32, 2, 2, 0],
  AERO_CONSOLE: [32, 32, 2, 2, 1],
  AERO_ARCADE: [16, 32, 1, 2, 1],
  AERO_WATERCOOLER: [16, 32, 1, 2, 1],
  AERO_POD_WHITEBOARD: [16, 32, 1, 2, 1],
  AERO_FLOWER_POT: [16, 16, 1, 1, 0],
  AERO_COFFEE_MACHINE: [16, 32, 1, 2, 1],
  AERO_BUFFET_COUNTER: [32, 32, 2, 2, 1],
  AERO_VENDING_MACHINE: [16, 32, 1, 2, 1],
  AERO_SECURITY_DESK: [32, 32, 2, 2, 1],
  AERO_TURNSTILE: [16, 32, 1, 2, 1],
  AERO_BALCONY_RAILING: [16, 16, 1, 1, 0],
  AERO_BALCONY_RAILING_SIDE: [16, 16, 1, 1, 0],
  AERO_ASHTRAY_STAND: [16, 32, 1, 2, 1],
  AERO_ELEVATOR: [32, 32, 2, 2, 1],
  AERO_GLASS_PARTITION: [16, 32, 1, 2, 1],
  AERO_GLASS_PARTITION_SIDE: [16, 32, 1, 2, 1],
  AERO_PLANTER_DIVIDER: [16, 32, 1, 2, 1],
  AERO_PLANTER_DIVIDER_SIDE: [16, 32, 1, 2, 1],
  AERO_TUBE_STATION: [16, 32, 1, 2, 0],
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

test('the twenty-three grids are whole: the right size, only palette characters, drawn in every tile', () => {
  const sprites = buildAeroSprites();
  assert.deepEqual(Object.keys(sprites).sort(), [...IDS].sort());
  for (const id of IDS) {
    const [w, h, fw, fh] = SIZES[id] as number[];
    const grid = AERO_SPRITE_GRIDS[id];
    assert.ok(grid, id);
    for (const row of grid.map) {
      for (const ch of row)
        assert.ok(ch === '.' || ch in grid.palette, `${id}: '${ch}' not in palette`);
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

test('every category is one of the editor categories, and never one the seat picker or the layout code reads', () => {
  const known = new Set(FURNITURE_CATEGORIES.map((c) => c.id));
  for (const e of aeroFurnitureCatalog()) {
    assert.ok(known.has(e.category), `${e.id}: ${e.category} is not in FURNITURE_CATEGORIES`);
    // chairs make seats, desks make work surfaces, electronics are PCs to the seat picker.
    assert.ok(!['chairs', 'desks', 'electronics'].includes(e.category), `${e.id}: ${e.category}`);
    const want = CATEGORIES[e.id];
    if (want) assert.equal(e.category, want, e.id);
  }
});

test('a seat facing any Aero piece is not an electronics seat; a stock PC still makes one', () => {
  const stock = stockCatalog();
  const sprite = (): SpriteData =>
    Array.from({ length: 32 }, () => new Array<string>(16).fill(GREY));
  stock.push(
    {
      ...stock[0]!,
      id: 'CHAIR',
      name: 'Chair',
      label: 'Chair',
      category: 'chairs',
      canPlaceOnWalls: false,
      orientation: 'front',
    },
    {
      ...stock[0]!,
      id: 'PC',
      name: 'PC',
      label: 'PC',
      category: 'electronics',
      canPlaceOnWalls: false,
    },
  );
  const m = withAeroFurniture(stock, { ...stockSprites(), CHAIR: sprite(), PC: sprite() });
  assert.ok(buildDynamicCatalog({ catalog: m.catalog, sprites: m.sprites }));
  const cols = 12;
  const rows = 12;
  const tiles = new Array<number>(cols * rows).fill(1);
  // A chair at (2,2) faces down: the piece is two or three tiles ahead, as a TV or a cabinet in a lounge would be.
  const seatFacing = (type: string, row: number): boolean => {
    const os = new OfficeState({
      version: 1,
      cols,
      rows,
      tiles: tiles as never,
      furniture: [
        { uid: 'chair', type: 'CHAIR', col: 2, row: 2 },
        { uid: 'piece', type: type, col: 2, row },
      ],
    });
    const priv = os as unknown as {
      buildElectronicsTileSet(): Set<string>;
      isSeatFacingElectronics(seat: unknown, tiles: Set<string>): boolean;
    };
    const seat = os.seats.get('chair');
    assert.ok(seat, 'the chair makes a seat');
    return priv.isSeatFacingElectronics(seat, priv.buildElectronicsTileSet());
  };
  assert.equal(
    seatFacing('PC', 4),
    true,
    'control: a stock electronics piece is a PC to the picker',
  );
  for (const type of [
    'AERO_CONSOLE',
    'AERO_ARCADE',
    'AERO_TOILET',
    'AERO_SINK',
    'AERO_FRIDGE',
    'AERO_PINGPONG',
    ...IDS.slice(6),
  ]) {
    assert.equal(seatFacing(type, 4), false, type);
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
    // The tube station is the one wall piece.
    assert.equal(e.canPlaceOnWalls, e.id === 'AERO_TUBE_STATION');
    // Only the flower pot goes on a desk.
    assert.equal(e.canPlaceOnSurfaces, e.id === 'AERO_FLOWER_POT', `${e.id} surface flag`);
    assert.equal(e.file, '');
    assert.equal(e.orientation, e.id.endsWith('_SIDE') ? 'side' : 'front', e.id);
  }
});

test('the merge adds all twenty-three, leaves the stock entry and its sprite alone, and never changes its inputs', () => {
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
  const sprites = { AERO_TOILET: [['#123456']] };
  const merged = withAeroFurniture(own, sprites);
  assert.equal(merged.catalog.filter((e) => e.id === 'AERO_TOILET').length, 1);
  assert.equal(merged.catalog[0]?.label, 'Theirs');
  assert.deepEqual(merged.sprites['AERO_TOILET'], [['#123456']]);

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

test('bad input never throws, and a catalog with nothing the page can build gets none of the pieces', () => {
  const bad: unknown[] = [undefined, null, 5, 'x', {}, [null, 3, {}, { id: 7 }]];
  for (const b of bad) {
    const merged = withAeroFurniture(b as never, b as never);
    assert.deepEqual(merged.catalog, [], 'no pieces on a catalog with no entry');
    assert.deepEqual(Object.keys(merged.sprites), []);
  }
  // Entries but no sprite for any: nothing the page could build either.
  const noSprites = withAeroFurniture(stockCatalog(), {});
  assert.equal(noSprites.catalog.length, 1);
  assert.deepEqual(Object.keys(noSprites.sprites), []);
  // One good entry among bad ones still gets the pieces, and the bad ones are dropped.
  const mixed = withAeroFurniture([null, ...stockCatalog(), { id: 7 }] as never, stockSprites());
  assert.equal(mixed.catalog.length, 1 + IDS.length);
  for (const id of IDS) assert.ok(mixed.sprites[id], id);
});

test('a later empty catalog does not wipe the one the page built', () => {
  const first = withAeroFurniture(stockCatalog(), stockSprites());
  assert.ok(buildDynamicCatalog({ catalog: first.catalog, sprites: first.sprites }));
  for (const [catalog, sprites] of [
    [[], {}],
    [[], stockSprites()],
    [null, null],
    [stockCatalog(), {}],
  ] as const) {
    const later = withAeroFurniture<AeroCatalogAsset>(
      catalog as AeroCatalogAsset[],
      sprites as Record<string, SpriteData>,
    );
    assert.equal(
      buildDynamicCatalog({ catalog: later.catalog, sprites: later.sprites }),
      false,
      'the build refuses it',
    );
    for (const id of IDS) assert.ok(getCatalogEntry(id), `${id} still there`);
    assert.ok(getCatalogEntry('WHITEBOARD'), 'WHITEBOARD still there');
  }
});

test('a layout naming the first six draws them and blocks their tiles by footprint and background rows', () => {
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

test('a layout naming all twenty-three blocks exactly the footprint rows below each background row', () => {
  const m = withAeroFurniture(stockCatalog(), stockSprites());
  buildDynamicCatalog({ catalog: m.catalog, sprites: m.sprites });
  const furniture: PlacedFurniture[] = IDS.map((type, i) => ({
    uid: `p${i}`,
    type,
    col: (i % 6) * 3,
    row: Math.floor(i / 6) * 4,
  }));
  assert.equal(layoutToFurnitureInstances(furniture).length, IDS.length);
  const blocked = getBlockedTiles(furniture);
  let want = 0;
  for (const [i, id] of IDS.entries()) {
    const [, , fw, fh, bg] = SIZES[id] as number[];
    const col = (i % 6) * 3;
    const row = Math.floor(i / 6) * 4;
    for (let dr = 0; dr < (fh as number); dr++) {
      for (let dc = 0; dc < (fw as number); dc++) {
        const isBlocked = blocked.has(`${col + dc},${row + dr}`);
        assert.equal(isBlocked, dr >= (bg as number), `${id} ${dc},${dr}`);
        if (dr >= (bg as number)) want++;
      }
    }
  }
  assert.equal(blocked.size, want);
});

test('the flower pot sits on a desk front row: accepted, in front of the desk, and blocks nothing more', () => {
  const desk: AeroCatalogAsset = {
    ...stockCatalog()[0]!,
    id: 'DESK_FRONT',
    name: 'Desk',
    label: 'Desk',
    category: 'desks',
    width: 48,
    height: 32,
    footprintW: 3,
    footprintH: 2,
    isDesk: true,
    canPlaceOnWalls: false,
    backgroundTiles: 1,
  };
  const sprites = {
    ...stockSprites(),
    DESK_FRONT: Array.from({ length: 32 }, () => new Array<string>(48).fill(GREY)),
  };
  const m = withAeroFurniture([...stockCatalog(), desk], sprites);
  assert.ok(buildDynamicCatalog({ catalog: m.catalog, sprites: m.sprites }));
  const cols = 10;
  const rows = 10;
  const layout = {
    version: 1 as const,
    cols,
    rows,
    tiles: new Array<number>(cols * rows).fill(1) as never,
    furniture: [{ uid: 'desk', type: 'DESK_FRONT', col: 2, row: 3 }] as PlacedFurniture[],
  };
  // The desk's front row (its bottom row), and its other tiles.
  for (const col of [2, 3, 4]) {
    assert.equal(canPlaceFurniture(layout, 'AERO_FLOWER_POT', col, 4), true, `front row ${col}`);
  }
  // A piece that isn't a surface piece can't go on the desk.
  assert.equal(canPlaceFurniture(layout, 'AERO_TURNSTILE', 2, 3), false);
  const withPot: PlacedFurniture[] = [
    ...layout.furniture,
    { uid: 'pot', type: 'AERO_FLOWER_POT', col: 3, row: 4 },
  ];
  const instances = layoutToFurnitureInstances(withPot);
  assert.equal(instances[1]!.zY, instances[0]!.zY + 0.5);
  assert.deepEqual(
    [...getBlockedTiles(withPot)].sort(),
    [...getBlockedTiles(layout.furniture)].sort(),
  );
});

test('the two railings are one rotation group: the palette shows it once, rotating gives the other, both resolve', () => {
  const m = withAeroFurniture(stockCatalog(), stockSprites());
  assert.ok(buildDynamicCatalog({ catalog: m.catalog, sprites: m.sprites }));
  const front = 'AERO_BALCONY_RAILING';
  const side = 'AERO_BALCONY_RAILING_SIDE';
  assert.equal(isRotatable(front), true);
  assert.equal(isRotatable(side), true);
  assert.equal(getRotatedType(front, 'cw'), side);
  assert.equal(getRotatedType(side, 'cw'), front);
  assert.equal(getRotatedType(front, 'ccw'), side);
  // Both ids still resolve for a layout that names them; only the front one is in the palette.
  assert.ok(getCatalogEntry(front));
  assert.ok(getCatalogEntry(side));
  const palette = getCatalogByCategory('decor').filter((e) => e.type.startsWith('AERO_BALCONY'));
  assert.deepEqual(
    palette.map((e) => e.type),
    [front],
  );
  // The glass partitions and the planter dividers are two more such groups; nothing else of Aero's is a rotation group.
  for (const group of ['AERO_GLASS_PARTITION', 'AERO_PLANTER_DIVIDER']) {
    assert.equal(isRotatable(group), true, group);
    assert.equal(isRotatable(`${group}_SIDE`), true, `${group}_SIDE`);
    assert.equal(getRotatedType(group, 'cw'), `${group}_SIDE`);
    assert.equal(getRotatedType(`${group}_SIDE`, 'cw'), group);
    assert.ok(getCatalogEntry(group) && getCatalogEntry(`${group}_SIDE`));
    const shown = getCatalogByCategory('decor').filter((e) => e.type.startsWith(group));
    assert.deepEqual(
      shown.map((e) => e.type),
      [group],
      `${group}: only the front piece is in the palette`,
    );
  }
  const grouped = ['AERO_BALCONY', 'AERO_GLASS_PARTITION', 'AERO_PLANTER_DIVIDER'];
  for (const id of IDS.filter((i) => !grouped.some((g) => i.startsWith(g)))) {
    assert.equal(isRotatable(id), false, id);
  }
});

test('the hook fields the self-test reads: desk and wall flags, uniform rows, palette presence', () => {
  const m = withAeroFurniture(stockCatalog(), stockSprites());
  assert.ok(buildDynamicCatalog({ catalog: m.catalog, sprites: m.sprites }));
  for (const id of IDS) {
    const entry = getCatalogEntry(id);
    assert.ok(entry, id);
    assert.equal(entry.isDesk, false, id);
    assert.equal(entry.canPlaceOnWalls ?? false, id === 'AERO_TUBE_STATION', id);
    assert.ok(
      entry.sprite.every((row) => row.length === entry.sprite[0]?.length),
      `${id} uniform rows`,
    );
    const inPalette = getCatalogByCategory(entry.category).some((e) => e.type === id);
    assert.equal(inPalette, !id.endsWith('_SIDE'), `${id} palette`);
  }
});

test('the lift is 2x2 with one background row, category misc, and is not a chair, desk or electronics piece', () => {
  const lift = aeroFurnitureCatalog().find((e) => e.id === 'AERO_ELEVATOR');
  assert.ok(lift);
  assert.deepEqual(
    [lift.width, lift.height, lift.footprintW, lift.footprintH, lift.backgroundTiles],
    [32, 32, 2, 2, 1],
  );
  assert.equal(lift.category, 'misc');
  assert.equal(lift.isDesk, false);
  assert.equal(lift.canPlaceOnSurfaces, false);
  // Doors below, a floor indicator above: both halves carry the picture, and the doors have a seam down the middle.
  const grid = AERO_SPRITE_GRIDS['AERO_ELEVATOR'];
  assert.ok(grid);
  assert.notEqual(grid.map.slice(0, 16).join(''), grid.map.slice(16).join(''));
  assert.ok(grid.map.slice(17, 29).every((row) => row.slice(15, 17) === 'qq'));
});
