// Declarations for the code that runs inside Chrome pages (the stage and
// the site) and reaches for what democast puts there, so `tsc` knows them.

interface Window {
  /** The stage page's API (stage.html). */
  stage: any;
  __democastClock: { tick(now: number): boolean };
  __democastSource?: string;
  __democastQuiet?: { t: string | null, at: number };
}

interface Animation {
  __start?: number;
  __done?: boolean;
  __step?: number;
}

// The CSS Custom Highlight API, which TypeScript's DOM types lack the
// map and set methods of.
interface HighlightRegistry extends Map<string, Highlight> {}
interface Highlight extends Set<AbstractRange> {}
