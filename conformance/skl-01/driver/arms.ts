import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ArmReadings } from "./derive.ts";

/**
 * The controlled arms of SKL-01.
 *
 * They drive the same core the deployed sensor loads, from the same checkout,
 * with no model in the loop. The mutation arm is the one that answers the
 * property directly: a capability that did not exist at the first listing must
 * be resolvable at the second, from the same adapter instance.
 *
 * The only write in this case happens here, in an OS temporary directory, and
 * the run asserts at the end that it is gone.
 */

/** The root the deployed sensor reads. Overridable for a rerun on another machine. */
export const DEFAULT_SKILL_ROOT = "/Users/memo/.agents/skills";

/** A name no real registry holds, so the `absent` arm cannot pass by accident. */
export const ABSENT_NAME = "skl-01-absent-probe";

/** The capability the `mutation` arm creates and removes. */
export const MUTATION_NAME = "skl-01-mutation-probe";

export interface ArmDetail {
  arm: string;
  reading: string;
  note: string;
}

export interface ArmsResult {
  readings: ArmReadings;
  details: ArmDetail[];
  registry: {
    root: string;
    capabilities: number;
    unreadable: number;
    anyRootUnreadable: boolean;
    mutationRemoved: boolean;
  };
}

interface Capability {
  kind: string;
  name: string;
  version: string;
  source: string;
}

interface Listing {
  capabilities: Capability[];
  unreadable: Array<{ folder: string; path: string; reason: string }>;
  anyRootUnreadable: boolean;
}

/**
 * Run every arm against the live registry and a temporary one.
 *
 * `cuesheetRoot` is read only. Nothing here writes inside it.
 */
export async function runArms(
  cuesheetRoot: string,
  skillRoot: string = DEFAULT_SKILL_ROOT,
): Promise<ArmsResult> {
  const capability = await import(`${cuesheetRoot}/src/core/capability.ts`);
  const { resolveCapabilities, isSpawnable } = capability;
  const { SkillsAdapter } = await import(`${cuesheetRoot}/src/adapters/skills.ts`);

  const adapter = new SkillsAdapter({ roots: [skillRoot] }) as { listCapabilities(): Listing };
  const listing = adapter.listCapabilities();
  const caps = [...listing.capabilities].sort((a, b) => a.name.localeCompare(b.name));
  const present = caps[0];

  const read = (requirements: Array<{ kind: string; name: string }>) =>
    resolveCapabilities(requirements, caps, { now: Date.now() }).verdict as string;

  const details: ArmDetail[] = [];
  const presentReading = present ? read([present]) : "no-capability-in-registry";
  details.push({
    arm: "present",
    reading: presentReading,
    note: present ? `resolved the first listing entry, ${present.name}` : "the live registry is empty",
  });

  const absentReading = read([{ kind: "skill", name: ABSENT_NAME }]);
  details.push({
    arm: "absent",
    reading: absentReading,
    note: `expected blocked; this is the control, a resolver that says yes to everything measures nothing`,
  });

  const emptyReading = read([]);
  details.push({
    arm: "empty",
    reading: emptyReading,
    note: `isSpawnable([]) reads ${String(isSpawnable([]))}, which answers a different question than "may this delegation proceed"`,
  });

  // Mutation arm: the property, reproduced. First listing, then create, then
  // the same adapter lists again.
  const scratch = mkdtempSync(join(tmpdir(), "skl-01-"));
  const mutationAdapter = new SkillsAdapter({ roots: [scratch] }) as { listCapabilities(): Listing };
  const before = mutationAdapter.listCapabilities().capabilities.length;
  const folder = join(scratch, MUTATION_NAME);
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "SKILL.md"),
    `---\nname: ${MUTATION_NAME}\ndescription: Temporary capability created by the SKL-01 conformance case, removed at the end of the run.\n---\n\n# ${MUTATION_NAME}\n`,
    "utf8",
  );
  const after = mutationAdapter.listCapabilities().capabilities;
  const created = after.find((c) => c.name === MUTATION_NAME);
  const mutationReading = created ? (resolveCapabilities([created], after, { now: Date.now() }).verdict as string) : "not-listed";
  details.push({
    arm: "mutation",
    reading: mutationReading,
    note: `same adapter instance: ${before} capability at the first listing, ${after.length} at the second`,
  });

  rmSync(scratch, { recursive: true, force: true });
  const mutationRemoved = !existsSync(scratch);

  return {
    readings: {
      present: presentReading,
      absent: absentReading,
      empty: emptyReading,
      mutation: mutationReading,
      mutationCleanedUp: mutationRemoved,
    },
    details,
    registry: {
      root: skillRoot,
      capabilities: listing.capabilities.length,
      unreadable: listing.unreadable.length,
      anyRootUnreadable: listing.anyRootUnreadable,
      mutationRemoved,
    },
  };
}
