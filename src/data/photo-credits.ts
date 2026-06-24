// Photographer credits keyed by image filename (basename only, no path).
//
// To add a credit: fill in the photographer's name (and optional
// handle/website) below. The PhotoCredit Astro component renders this
// as a small italic caption under the corresponding image.
//
// Leave value empty ('') to suppress the credit for an image (e.g.
// founder selfies, screenshots, illustrations).

export type PhotoCredit = {
  photographer: string;
  /** Optional Instagram handle (without the @). */
  instagram?: string;
  /** Optional website URL the photographer wants credited. */
  url?: string;
};

export const PHOTO_CREDITS: Record<string, PhotoCredit> = {
  // ── About page (Emily's story slideshow) ──────────────────────────
  'EmilyPhelan-London-YellowCard.jpg':   { photographer: 'Sideline Photography' },  // Ch 1: My Story
  'EmilyPhelan-Depressed.jpg':           { photographer: 'Photographer TBC' },      // Ch 2: A Difficult Phase
  'IMG_7228.jpg':                        { photographer: 'Martha Jordan' },         // Ch 3: What That Felt Like
  'EmilyPhelan-London-Playing-1.jpg':    { photographer: 'Sideline Photography' },  // Ch 4: Hitting Rock Bottom
  'EmilyPhelan-Holloway-Playing.jpg':    { photographer: 'Martha Jordan' },         // Ch 5: Why This Platform Exists

  // ── Homepage bands ────────────────────────────────────────────────
  'DSC_1538.jpg':                        { photographer: 'Photographer TBC' },      // Why band (1st photo down)
  'FLO_1671.jpg':                        { photographer: 'Photographer TBC' },      // Mental band (2nd photo down)
  'CiaraFlan-London-1.jpg':              { photographer: 'Sideline Photography' },  // Physical band (3rd photo down)
  'HollowayTeamHuddle.jpg':              { photographer: 'Photographer TBC' },      // Content hub band (4th photo down)
};

/**
 * Resolve a photographer credit for an imported Astro image asset.
 * Astro's image .src can take multiple shapes depending on environment:
 *   - dev (via Vite):  "/@fs/Users/.../src/assets/EmilyPhelan-Depressed.jpg"
 *   - dev (image API): "/_image?href=%2Fsrc%2Fassets%2FEmilyPhelan-Depressed.jpg&w=800&format=webp"
 *   - build:           "/_astro/EmilyPhelan-Depressed.HASH.jpg"
 * Rather than try to parse each shape, we just check whether any known
 * filename (or its stem) appears as a substring of the src. Keys are
 * checked longest-first so more-specific names win over shorter ones.
 */
export function getCreditForAsset(src: string | undefined | null): PhotoCredit | null {
  if (!src) return null;
  const decoded = (() => {
    try { return decodeURIComponent(src); } catch { return src; }
  })();
  const sortedKeys = [...Object.keys(PHOTO_CREDITS)].sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    const stem = key.replace(/\.[^.]+$/, '');
    if (decoded.includes(key) || decoded.includes(stem)) {
      return PHOTO_CREDITS[key];
    }
  }
  return null;
}
