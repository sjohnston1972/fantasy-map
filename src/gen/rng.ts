// Seeded randomness. Every random choice in the generator comes from here, so the same
// seed always gives the same map (spec: "Seed and settings").

// Mulberry32: small, fast, and good enough for terrain. Returns numbers in [0, 1).
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A separate seed for each pipeline stage, derived from the map seed and the stage's
// name. Stages never share a random stream, so adding or changing one stage does not
// shift the random numbers another stage sees.
export function stageSeed(seed: number, stage: string): number {
  let h = 2166136261 ^ (seed >>> 0);
  for (let i = 0; i < stage.length; i++) h = Math.imul(h ^ stage.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

// A new random seed for the "random" button (not used inside generation).
export function randomSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % 1_000_000;
}
