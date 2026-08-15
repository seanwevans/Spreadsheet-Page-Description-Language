/**
 * Globals the Office Scripts host provides besides the ExcelScript namespace.
 * `console.log` is the only one the renderer uses (for the commands it has to
 * skip), and the DOM/Node lib types are deliberately not pulled in — an
 * Office Script has neither.
 */
declare const console: {
  log(...data: unknown[]): void;
};
