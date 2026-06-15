import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement canvas. The home page's ambient pathfinder calls
// getContext on mount; stub it to return null so the effect bails cleanly
// instead of emitting jsdom's "not implemented" noise.
HTMLCanvasElement.prototype.getContext = (() =>
  null) as typeof HTMLCanvasElement.prototype.getContext;
