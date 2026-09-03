import { z } from "zod";
import { db } from "@/db";
import {
  cycleOffsetAnchorEnum,
  dateRelativeModeEnum,
  packPhase,
  taskEffortEnum,
  taskOpennessEnum,
  taskPack,
  taskPackItem,
} from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError } from "../errors";
import { getTaskPack } from "./crud";

type Member = typeof memberTable.$inferSelect;

// The portable, hand-delivered JSON shape a Task Pack round-trips as
// between two separate Orchard deployments — see docs/spec.md's Task
// Pack ("a pack round-trips as a plain file, the same 'link, don't
// host' precedent Task Resources already established, not a hosted
// registry"). Deliberately just the pack's own content, no ids —
// re-importing the same file twice creates two independent local
// packs, the same way uploading the same image twice creates two
// Resources.
const packFilePhase = z.object({
  name: z.string().min(1),
  order: z.number().int(),
  startRelativeMode: z.enum(dateRelativeModeEnum.enumValues).nullable(),
  startOffsetAnchor: z.enum(cycleOffsetAnchorEnum.enumValues).nullable(),
  startOffsetDays: z.number().int().nullable(),
  startPercent: z.number().int().nullable(),
  endRelativeMode: z.enum(dateRelativeModeEnum.enumValues).nullable(),
  endOffsetAnchor: z.enum(cycleOffsetAnchorEnum.enumValues).nullable(),
  endOffsetDays: z.number().int().nullable(),
  endPercent: z.number().int().nullable(),
});

const packFileItem = z.object({
  branchNameHint: z.string().min(1),
  phaseRef: z.number().int().nullable(),
  title: z.string().min(1),
  description: z.string(),
  tags: z.array(z.string()),
  effort: z.enum(taskEffortEnum.enumValues),
  effortMagnitude: z.unknown(),
  critical: z.boolean(),
  capacity: z.number().int().nullable(),
  openness: z.enum(taskOpennessEnum.enumValues),
  endorsementThreshold: z.number().int().nullable(),
  requirements: z.array(z.object({ type: z.string(), mode: z.string(), value: z.unknown() })),
  wikiSummarySeed: z.string().nullable(),
  resources: z.array(z.object({ label: z.string(), url: z.string(), tag: z.string().nullable() })),
  milestones: z.array(
    z.object({
      label: z.string(),
      anchorType: z.string().nullable(),
      relativeMode: z.string().nullable(),
      offsetDays: z.number().int().nullable(),
      percent: z.number().int().nullable(),
      phaseRef: z.number().int().nullable(),
    }),
  ),
});

export const packFile = z.object({
  formatVersion: z.literal(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  source: z.string().nullable(),
  version: z.string(),
  domainTags: z.array(z.string()),
  phases: z.array(packFilePhase),
  items: z.array(packFileItem),
});
export type PackFile = z.infer<typeof packFile>;

export async function exportTaskPackToFile(actor: Member, packId: string): Promise<PackFile> {
  const { pack, phases, items } = await getTaskPack(actor, packId);
  return {
    formatVersion: 1,
    name: pack.name,
    description: pack.description,
    source: pack.source,
    version: pack.version,
    domainTags: pack.domainTags,
    phases: phases.map((p) => ({
      name: p.name,
      order: p.order,
      startRelativeMode: p.startRelativeMode,
      startOffsetAnchor: p.startOffsetAnchor,
      startOffsetDays: p.startOffsetDays,
      startPercent: p.startPercent,
      endRelativeMode: p.endRelativeMode,
      endOffsetAnchor: p.endOffsetAnchor,
      endOffsetDays: p.endOffsetDays,
      endPercent: p.endPercent,
    })),
    items: items.map((i) => ({
      branchNameHint: i.branchNameHint,
      phaseRef: i.phaseRef,
      title: i.title,
      description: i.description,
      tags: i.tags,
      effort: i.effort,
      effortMagnitude: i.effortMagnitude,
      critical: i.critical,
      capacity: i.capacity,
      openness: i.openness,
      endorsementThreshold: i.endorsementThreshold,
      requirements: i.requirements as PackFile["items"][number]["requirements"],
      wikiSummarySeed: i.wikiSummarySeed,
      resources: i.resources as PackFile["items"][number]["resources"],
      milestones: i.milestones as PackFile["items"][number]["milestones"],
    })),
  };
}

// "Uploading" a pack adopts it as a real, local TaskPack row scoped to
// the importing Community — the same local library entry a directly-
// exported pack gets, so the rest of the import flow (branch
// reconciliation, the date preview, creating a cycle from it) never
// needs to know whether a pack originated locally or from a file.
export async function importTaskPackFromFile(actor: Member, rawJson: unknown) {
  const parsed = packFile.safeParse(rawJson);
  if (!parsed.success) {
    throw new AppError(`Not a valid Task Pack file: ${parsed.error.issues[0]?.message ?? "invalid shape"}`);
  }
  const file = parsed.data;

  return db.transaction(async (tx) => {
    const [pack] = await tx
      .insert(taskPack)
      .values({
        communityId: actor.communityId,
        name: file.name,
        description: file.description,
        source: file.source,
        version: file.version,
        domainTags: file.domainTags,
        createdBy: actor.id,
      })
      .returning();

    if (file.phases.length > 0) {
      await tx.insert(packPhase).values(file.phases.map((p) => ({ packId: pack.id, ...p })));
    }
    if (file.items.length > 0) {
      await tx.insert(taskPackItem).values(
        file.items.map((i) => ({
          packId: pack.id,
          ...i,
          effortMagnitude: i.effortMagnitude as object,
        })),
      );
    }

    return pack;
  });
}
