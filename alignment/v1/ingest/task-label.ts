/**
 * Coarse task label from a harness's working directory.
 *
 * The label is the deepest project-ish path segment. Never personal content,
 * never deeper than the project root: this is what goes into a public table.
 */
export function labelFromDir(dir: string | null): string | null {
  if (!dir) return null;
  const parts = dir.split("/").filter(Boolean);
  let out: string | null = null;
  for (const p of parts.slice().reverse()) {
    if (p === "" || p.startsWith(".")) continue;
    out = p;
    break;
  }
  return out;
}
