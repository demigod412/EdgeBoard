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
  const marks: string[] = [];
  return {
    mark(name: string, extra?: string) {
      const now = Date.now();
      marks.push(`${name}=${now - last}ms${extra ? `(${extra})` : ""}`);
      last = now;
    },
    done(extra?: string) {
      const rss = Math.round(process.memoryUsage().rss / 1048576);
      const heap = Math.round(process.memoryUsage().heapUsed / 1048576);
      console.error(`[timing] ${label} ${marks.join(" ")} total=${Date.now() - t0}ms rss=${rss}MB heap=${heap}MB${extra ? ` ${extra}` : ""}`);
    },
  };
}
