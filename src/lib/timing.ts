/**
 * One line per render of an expensive page, to stderr — which on a systemd box means `journalctl -u <app>`.
 *
 * Added because a scanner rendering 317 games was taking ninety seconds and allocating hundreds of
 * megabytes, and reading the code could not explain it: the query is small, the per-row work is a property
 * read and a sort, and the data behind it is under a megabyte. Guessing had already been wrong twice, so
 * the page now reports its own phases and the argument stops being about plausibility.
 *
 * Deliberately always on. It is one short line per request on pages that take seconds, so it costs nothing
 * worth measuring, and the moment it is behind a flag it will be off on the machine that has the problem.
 */
export function phases(label: string) {
  const t0 = Date.now();
  let last = t0;
  const mem = () => {
    const m = process.memoryUsage();
    return `rss=${Math.round(m.rss / 1048576)}MB heap=${Math.round(m.heapUsed / 1048576)}MB`;
  };
  /*
   * Each mark prints as it happens rather than being collected for one line at the end.
   *
   * The first version buffered and printed once on completion, and the first request that mattered was
   * OOM-killed — which discards whatever Node had buffered for stderr, so the only diagnostic for the
   * only interesting run was lost. Breadcrumbs that survive the process are worth more than a tidy line.
   */
  return {
    mark(name: string, extra?: string) {
      const now = Date.now();
      console.error(`[timing] ${label} ${name}=${now - last}ms${extra ? ` (${extra})` : ""} at=${now - t0}ms ${mem()}`);
      last = now;
    },
    done(extra?: string) {
      console.error(`[timing] ${label} DONE total=${Date.now() - t0}ms ${mem()}${extra ? ` ${extra}` : ""}`);
    },
  };
}
