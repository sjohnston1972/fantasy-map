// Place names (spec open question "Name generation": a built-in generator of fantasy-style
// place names). Steven asked for names that vary by region, so each part of the map gets a
// naming culture: Norse in the cold north, Celtic in the west, Old English in the heartland,
// and softer southern names in the warm south. Names are built from word parts the way
// real place names are (a first part plus an ending, like Thorn + wick).

export type Culture = "english" | "norse" | "celtic" | "southern";

interface Parts {
  starts: string[];
  ends: string[];
  water: string[]; // endings that suit places by water
  river: string[]; // whole river names
  wild: string[]; // words for rough country
}

const CULTURES: Record<Culture, Parts> = {
  english: {
    starts: ["Ash", "Brad", "Elm", "Harrow", "Thorn", "Ald", "Wick", "Hazel", "Bramble", "Cold", "Oak", "Wether", "Mill", "Ray", "Ship", "Lang", "Stow", "Fern", "Marl", "Hollin", "Kings", "Sutton", "Wood", "Black", "Whit"],
    ends: ["ford", "ton", "wick", "bury", "ham", "ley", "field", "worth", "stead", "combe", "hurst", "den", "well", "borough"],
    water: ["mere", "ford", "brook", "wick", "haven", "mouth", "ey"],
    river: ["Thorn", "Wendle", "Aller", "Mere", "Brant", "Eden", "Lark", "Swale", "Tamber", "Sedge"],
    wild: ["Downs", "Weald", "Chase", "Moor", "Heath"],
  },
  norse: {
    starts: ["Skel", "Grim", "Thor", "Kirk", "Ul", "Rav", "Stein", "Ask", "Holm", "Sval", "Frey", "Hald", "Bjorn", "Dal", "Ketil", "Orm", "Fjall", "Ey"],
    ends: ["by", "thorpe", "vik", "holm", "gard", "dal", "stad", "heim", "fell", "sund", "nes", "toft"],
    water: ["vik", "nes", "sund", "holm", "fjord"],
    river: ["Elv", "Skarn", "Thurso", "Rauma", "Vesle", "Grimsa", "Ulla", "Kalda"],
    wild: ["Fells", "Mark", "Heath", "Moss"],
  },
  celtic: {
    starts: ["Aber", "Dun", "Glen", "Llan", "Kil", "Inver", "Pen", "Bryn", "Car", "Ard", "Tre", "Bally", "Mor", "Caer", "Lis", "Dol"],
    ends: ["more", "ach", "an", "wen", "dair", "loch", "garth", "rin", "don", "ross", "mona", "avon"],
    water: ["loch", "avon", "mouth", "ross", "lin"],
    river: ["Avon", "Tavy", "Conwy", "Taw", "Dee", "Nevis", "Afon Du", "Glas"],
    wild: ["Moors", "Hills", "Bens", "Glens"],
  },
  southern: {
    starts: ["Val", "Mar", "Cor", "Ser", "Aur", "Lum", "Sol", "Ven", "Ter", "Cal", "Ros", "Mir", "Fal", "Cas", "Ala"],
    ends: ["ena", "ano", "ora", "ille", "ara", "enza", "ino", "ete", "osa", "ia", "anta", "ello"],
    water: ["ara", "ena", "ore", "ossa", "ina"],
    river: ["Alba", "Serra", "Lune", "Vara", "Tessa", "Orla", "Sorrel", "Vienne"],
    wild: ["Wastes", "Steppe", "Barrens", "Marches"],
  },
};

// Which culture names a point on the map. Position decides it, with a seeded twist so each
// map divides its regions differently. `north` and `west` run 0 to 1 from the top and left.
export function cultureAt(north: number, west: number, temperature: number, twist: number): Culture {
  const cold = temperature < 0.32 || north < 0.22 + twist * 0.15;
  if (cold) return "norse";
  const warm = temperature > 0.62 || north > 0.8 - twist * 0.12;
  if (warm) return "southern";
  if (west < 0.3 + twist * 0.1) return "celtic";
  return "english";
}

// Ways to title a map after its capital, in the style of the capital's region.
const TITLE_FORMS: Record<Culture, string[]> = {
  norse: ["The Jarldom of %", "The Northern Reaches of %", "The Kingdom of %"],
  celtic: ["The Kingdom of %", "The Lands of %", "The High Kingdom of %"],
  english: ["The Realm of %", "The Kingdom of %", "The Shire of %"],
  southern: ["The Principality of %", "The Free Cities of %", "The Duchy of %"],
};

export function titleOptions(c: Culture, capital: string): string[] {
  return TITLE_FORMS[c].map((f) => f.replace("%", capital));
}

export class Namer {
  private used = new Set<string>();
  constructor(private next: () => number) {}

  private pick<T>(list: T[]): T {
    return list[Math.floor(this.next() * list.length)];
  }

  // Keep every name on a map unique; try a few combinations before adding a word.
  private unique(make: () => string): string {
    for (let k = 0; k < 20; k++) {
      const n = make();
      if (!this.used.has(n)) {
        this.used.add(n);
        return n;
      }
    }
    const n = `${make()} ${this.pick(["Minor", "Upon Hill", "End", "Cross"])}`;
    this.used.add(n);
    return n;
  }

  place(c: Culture, byWater = false): string {
    const p = CULTURES[c];
    return this.unique(() => {
      const start = this.pick(p.starts);
      const pool = byWater && this.next() < 0.6 ? p.water : p.ends;
      // A start ending in a vowel (or y) needs an ending that begins with a consonant, or
      // the join reads badly (Rayey, Alaello).
      const vowelEnd = /[aeiouy]$/i.test(start);
      const fits = pool.filter((e) => !(vowelEnd && /^[aeiouy]/i.test(e)));
      let end = this.pick(fits.length ? fits : pool);
      // Avoid doubled letters that read badly (Skelldal, Harrowwick).
      if (start.endsWith(end[0])) end = end.slice(1);
      return start + end;
    });
  }

  river(c: Culture): string {
    return this.unique(() => (c === "celtic" ? `Afon ${this.pick(CULTURES[c].river)}` : `River ${this.pick(CULTURES[c].river)}`));
  }

  lake(c: Culture): string {
    const root = this.place(c, true);
    return this.unique(() => (c === "norse" ? `${root}vatn` : c === "celtic" ? `Loch ${root}` : `Lake ${root}`));
  }

  region(c: Culture, kind: "forest" | "mountain" | "marsh" | "desert" | "tundra" | "grassland"): string {
    const p = CULTURES[c];
    const root = this.pick(p.starts);
    return this.unique(() => {
      switch (kind) {
        case "forest":
          return this.pick([`The ${root}wood`, `${root}wood Forest`, `Forest of ${this.pick(p.starts)}${this.pick(p.ends)}`]);
        case "mountain":
          return this.pick([`The ${root} Mountains`, `The ${root}${c === "norse" ? "fell" : ""} Peaks`, `${root} Crags`]);
        case "marsh":
          return this.pick([`${root} Fen`, `The ${root} Marshes`, `${root} Moss`]);
        case "desert":
          return this.pick([`The ${root} Wastes`, `${root} Sands`]);
        case "tundra":
          return this.pick([`The ${root} Wilds`, `${root} Barrens`]);
        default:
          return `The ${root} ${this.pick(p.wild)}`;
      }
    });
  }

  // The map's title, named for its capital in the style of the capital's region.
  title(c: Culture, capital: string): string {
    return this.pick(titleOptions(c, capital));
  }

  sea(c: Culture): string {
    return this.unique(() => this.pick([`The ${this.pick(["Grey", "Silver", "Western", "Northern", "Quiet", "Stormy", "Amber"])} Sea`, `${this.pick(CULTURES[c].starts)} Sound`, `The Sea of ${this.place(c)}`]));
  }
}
