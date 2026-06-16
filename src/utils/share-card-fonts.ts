/**
 * Font pre-loading utility for share card PNG/GIF export.
 *
 * html-to-image serialises the DOM into an SVG <foreignObject> clone. Even
 * when Google Fonts are already visually rendering on the page, the clone
 * context may miss the @font-face declarations unless the browser has fully
 * resolved and cached them BEFORE toPng runs. Without this step the fallback
 * system monospace is used, which triggers faux-bold synthesis (double-strike
 * offset) for fontWeight 700/800 at small sizes — the "ghosted" glyph bug.
 *
 * This helper:
 *  1. Waits for the document font-loading pipeline to drain (fonts.ready).
 *  2. Explicitly loads every IBM Plex Mono weight used by the share cards so
 *     the FontFace objects are guaranteed LOADED (not just "loading") before
 *     html-to-image runs its capture.
 */

const IBM_PLEX_MONO = "'IBM Plex Mono'";
const WEIGHTS = ['400', '500', '600', '700', '800'] as const;

let _preloadPromise: Promise<void> | null = null;

export async function preloadShareCardFonts(): Promise<void> {
  // Reuse in-flight promise so concurrent callers don't double-load
  if (_preloadPromise) return _preloadPromise;

  _preloadPromise = (async () => {
    // Wait for all already-queued font loads to finish first
    await document.fonts.ready;

    // Explicitly request each weight so the browser promotes them from
    // "loading" / "unloaded" to "loaded" status
    const loadPromises = WEIGHTS.map((w) =>
      document.fonts.load(`${w} 16px ${IBM_PLEX_MONO}`).catch(() => {
        // Non-fatal: if a weight isn't available (e.g. 800 not yet in the
        // Google Fonts URL) we log and continue rather than blocking export
        console.warn(`[share-card-fonts] Could not load IBM Plex Mono weight ${w}`);
      })
    );

    await Promise.all(loadPromises);
  })();

  return _preloadPromise;
}
