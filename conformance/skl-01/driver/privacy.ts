import { createHash } from "node:crypto";

/**
 * A session id never leaves this case in clear.
 *
 * The digest is stable, so two runs over the same spool produce the same
 * table, and short enough to keep a table readable. This is not anonymisation
 * and it is not claimed as one: it is the publication rule fixed in SPEC.md
 * under "Privacy rules". The raw spool stays where the sensor writes it.
 */
export function sessionDigest(sessionID: string): string {
  return createHash("sha256").update(sessionID).digest("hex").slice(0, 10);
}
