/**
 * First names and roles for the characters over the office (docs/work/phase6-office-look/plan.md, task A).
 *
 * A name is made here from what the page has: a stable key, the sprite's palette and, for a role, the roster's slug. No name
 * comes from a transcript or a file. Even palettes read as men and odd as women (char_0/2/4 and char_1/3/5), so they take
 * names from the men's and the women's list.
 */

export const MEN_NAMES: readonly string[] = [
  'Leo',
  'Max',
  'Sam',
  'Noah',
  'Eli',
  'Finn',
  'Jack',
  'Theo',
  'Oscar',
  'Ben',
  'Luke',
  'Adam',
  'Hugo',
  'Ravi',
  'Omar',
  'Kai',
  'Liam',
  'Ivan',
  'Nico',
  'Dan',
  'Tom',
  'Jonas',
  'Felix',
  'Marco',
  'Arjun',
  'Pablo',
  'Yusuf',
  'Erik',
  'Tariq',
  'Milo',
  'Owen',
  'Ryan',
  'Cal',
  'Hans',
  'Ian',
  'Joel',
  'Karl',
  'Lars',
  'Mateo',
  'Niko',
  'Otto',
  'Paul',
  'Remy',
  'Seth',
  'Tobias',
  'Victor',
  'Walt',
  'Zane',
  'Alvin',
  'Boris',
  'Caleb',
  'Dario',
  'Elias',
  'Frank',
  'Gus',
  'Henry',
  'Igor',
  'Jules',
  'Kofi',
  'Lukas',
  'Moses',
  'Nolan',
  'Olaf',
  'Pedro',
  'Quinn',
  'Rafa',
  'Stan',
  'Timo',
  'Uri',
  'Vince',
  'Wade',
  'Yann',
];

export const WOMEN_NAMES: readonly string[] = [
  'Ava',
  'Maya',
  'Zoe',
  'Nina',
  'Lena',
  'Mia',
  'Ella',
  'Ivy',
  'Rosa',
  'Anna',
  'Clara',
  'Dana',
  'Emma',
  'Freya',
  'Gina',
  'Hana',
  'Iris',
  'Jade',
  'Kira',
  'Lila',
  'Mara',
  'Nora',
  'Olga',
  'Pia',
  'Rita',
  'Sara',
  'Tess',
  'Uma',
  'Vera',
  'Wren',
  'Yara',
  'Zara',
  'Alba',
  'Bella',
  'Cora',
  'Dora',
  'Esme',
  'Fay',
  'Greta',
  'Holly',
  'Isla',
  'Jana',
  'Kate',
  'Lucy',
  'Mina',
  'Nadia',
  'Opal',
  'Petra',
  'Rhea',
  'Sofia',
  'Tara',
  'Una',
  'Viola',
  'Willa',
  'Xena',
  'Yuki',
  'Zelda',
  'Aria',
  'Bea',
  'Cleo',
  'Dina',
  'Elsa',
  'Faye',
  'Gwen',
  'Hope',
  'Inga',
  'June',
  'Kaya',
  'Lola',
  'Mona',
  'Noor',
  'Orla',
];

const MAX_ROLE = 20;

/** FNV-1a over the key's UTF-16 units with a final mix, so every bit of the result depends on the whole key: a fixed, non-negative 32-bit integer. */
export function hashKey(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * A first name for each entry: the men's list for an even palette and the women's for an odd one, at the salted hash of the key and
 * on to the next name not yet taken (`taken` are names already in use, which are never given again). A pure function of the entries
 * and `taken`, the entries taken in key order. More entries than names repeat names at the end.
 */
export function assignFirstNames(
  entries: ReadonlyArray<{ key: string; palette: number }>,
  taken: ReadonlySet<string> = new Set(),
): Map<string, string> {
  const sorted = [...entries].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const used = new Set(taken);
  const out = new Map<string, string>();
  for (const { key, palette } of sorted) {
    if (out.has(key)) continue;
    const list = palette % 2 === 0 ? MEN_NAMES : WOMEN_NAMES;
    const start = hashKey(`name:${key}`) % list.length;
    let pick = list[start]!;
    for (let i = 0; i < list.length; i++) {
      const name = list[(start + i) % list.length]!;
      if (!used.has(name)) {
        pick = name;
        break;
      }
    }
    used.add(pick);
    out.set(key, pick);
  }
  return out;
}

/** The set key of a look (a palette and a hue turn in degrees). */
export const lookKey = (palette: number, hue: number): string => `${palette}/${hue}`;

/**
 * A person's look from its key: its own palette with no tint; when a person of the floor has it, the next free palette; a hue turn
 * (60 degrees a turn) only once every palette is used. `used` holds the `lookKey`s taken on the floor.
 */
export function pickLook(
  key: string,
  palettes: number,
  used: ReadonlySet<string>,
): { palette: number; hue: number } {
  const count = Math.max(1, palettes);
  const start = hashKey(key) % count;
  for (let turn = 0; turn < 6; turn++) {
    for (let i = 0; i < count; i++) {
      const palette = (start + i) % count;
      if (!used.has(lookKey(palette, turn * 60))) return { palette, hue: turn * 60 };
    }
  }
  return { palette: start, hue: 0 };
}

const roles = new Map<string, string>();

/** `code-reviewer` is `Reviewer`: the `code-` and `aero-` prefixes go, the words are title-cased, and it is cut at 20. */
export function roleFromSlug(slug: string): string {
  const known = roles.get(slug);
  if (known !== undefined) return known;
  const bare = slug.replace(/^(code|aero)-(?=.)/, '');
  const words = bare.split(/[-_\s]+/).filter((w) => w !== '');
  let role = 'Agent';
  if (words.length > 0) {
    const text = words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ');
    role = text.length > MAX_ROLE ? text.slice(0, MAX_ROLE) : text;
  }
  if (roles.size >= 512) roles.clear();
  roles.set(slug, role);
  return role;
}
