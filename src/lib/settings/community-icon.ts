import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { db } from "@/db";
import { community, communityIcon, type member as memberTable } from "@/db/schema";
import { AppError } from "../errors";
import { requireNotOnsiteLocked } from "../onsite-mode";
import { getCommunity } from "./community";
import { recordSettingChanges } from "./history";

type Member = typeof memberTable.$inferSelect;

// One uploaded PNG becomes the whole set of icons a browser, a phone home
// screen, and an install prompt each ask for. The sizes are not arbitrary:
// 16/32/48 are what a tab strip, a taskbar, and a legacy .ico ask for; 180 is
// Apple's touch icon; 192 and 512 are the two Android/Chromium install sizes;
// and the maskable one is the same 512 with the mark pulled into the safe
// circle so Android can crop it to whatever shape the launcher uses.
//
// The library owns this vocabulary — the database only stores what is named
// here — so adding a size is a change in this file, not a migration.
export const COMMUNITY_ICON_VARIANTS = {
  "16": { size: 16, contentType: "image/png" },
  "32": { size: 32, contentType: "image/png" },
  "48": { size: 48, contentType: "image/png" },
  "180": { size: 180, contentType: "image/png" },
  "192": { size: 192, contentType: "image/png" },
  "512": { size: 512, contentType: "image/png" },
  "maskable-512": { size: 512, contentType: "image/png", maskable: true },
  "favicon.ico": { contentType: "image/x-icon" },
} as const;

export type CommunityIconVariant = keyof typeof COMMUNITY_ICON_VARIANTS;

export function isCommunityIconVariant(value: string): value is CommunityIconVariant {
  return Object.prototype.hasOwnProperty.call(COMMUNITY_ICON_VARIANTS, value);
}

export const COMMUNITY_ICON_ACCEPT = "image/png,.png";
export const COMMUNITY_ICON_MAX_BYTES = 8 * 1024 * 1024;
export const COMMUNITY_ICON_MIN_DIMENSION = 64;
const MAX_SOURCE_DIMENSION = 4096;

// The design tokens' documented primary when a community hasn't set one —
// the same fallback src/app/layout.tsx and GeneralTab use.
const DEFAULT_ACCENT = "#3a6cd9";
// The Orchard mark's own background. Used only when flattening the *default*
// mark for Apple/maskable, where transparency would otherwise be filled with
// black by the platform.
const DEFAULT_MARK_BACKGROUND = "#2f6b4f";
const DEFAULT_ICON_PATH = path.join(process.cwd(), "public", "icon.svg");

/** A PNG at `size`, containing the whole image without stretching it.
 *
 *  `background` flattens transparency, which Apple's touch icon needs (iOS
 *  paints transparent pixels black) and a maskable icon needs so the launcher
 *  never shows a hole. `maskable` pulls the mark into the central 80%, which
 *  is the area every launcher mask is guaranteed to keep. */
async function renderPng(
  source: Buffer,
  size: number,
  options: { background?: string; maskable?: boolean } = {},
): Promise<Buffer> {
  const contentSize = options.maskable ? Math.round(size * 0.8) : size;
  let pipeline = sharp(source, { limitInputPixels: MAX_SOURCE_DIMENSION * MAX_SOURCE_DIMENSION })
    .rotate()
    .resize(contentSize, contentSize, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });

  if (options.background) {
    pipeline = pipeline.flatten({ background: options.background });
  }

  if (options.maskable) {
    const pad = Math.round((size - contentSize) / 2);
    pipeline = pipeline.extend({
      top: pad,
      bottom: size - contentSize - pad,
      left: pad,
      right: size - contentSize - pad,
      background: options.background ?? DEFAULT_ACCENT,
    });
  }

  return pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
}

/** An ICO container holding PNGs. Vista and everything since read PNG data
 *  directly, so this is a header and a table of contents, not a second image
 *  encoder. Sizes are 16/32/48 — the tab, the taskbar, and Explorer's large
 *  view. */
function packIco(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const entries = Buffer.alloc(images.length * 16);
  let offset = header.length + entries.length;
  images.forEach((image, index) => {
    const entry = index * 16;
    // 0 means 256 in the ICO format; none of ours reaches that, but the
    // branch is the format's rule rather than a special case for today.
    entries.writeUInt8(image.size >= 256 ? 0 : image.size, entry);
    entries.writeUInt8(image.size >= 256 ? 0 : image.size, entry + 1);
    entries.writeUInt8(0, entry + 2); // colour palette
    entries.writeUInt8(0, entry + 3); // reserved
    entries.writeUInt16LE(1, entry + 4); // colour planes
    entries.writeUInt16LE(32, entry + 6); // bits per pixel
    entries.writeUInt32LE(image.png.length, entry + 8);
    entries.writeUInt32LE(offset, entry + 12);
    offset += image.png.length;
  });

  return Buffer.concat([header, entries, ...images.map((image) => image.png)]);
}

/** The uploaded image as every variant. The maskable and Apple variants are
 *  flattened onto the community's primary accent, because that is the colour
 *  the community has already chosen to sit behind its mark. */
export async function generateCommunityIcons(
  source: Buffer,
  accent: string | null,
): Promise<Record<CommunityIconVariant, Buffer>> {
  const background = accent ?? DEFAULT_ACCENT;
  const [png16, png32, png48, png180, png192, png512, maskable] = await Promise.all([
    renderPng(source, 16),
    renderPng(source, 32),
    renderPng(source, 48),
    renderPng(source, 180, { background }),
    renderPng(source, 192),
    renderPng(source, 512),
    renderPng(source, 512, { maskable: true, background }),
  ]);

  return {
    "16": png16,
    "32": png32,
    "48": png48,
    "180": png180,
    "192": png192,
    "512": png512,
    "maskable-512": maskable,
    "favicon.ico": packIco([
      { size: 16, png: png16 },
      { size: 32, png: png32 },
      { size: 48, png: png48 },
    ]),
  };
}

// The default mark never changes, so each variant is rendered at most once
// per process. The promise (not the buffer) is cached so concurrent first
// requests share one render rather than racing.
const defaultIconCache = new Map<CommunityIconVariant, Promise<Buffer>>();

function renderDefaultIcon(variant: CommunityIconVariant): Promise<Buffer> {
  const cached = defaultIconCache.get(variant);
  if (cached) return cached;

  const rendered = (async () => {
    const svg = await readFile(DEFAULT_ICON_PATH);
    if (variant === "favicon.ico") {
      const [png16, png32, png48] = await Promise.all([
        renderPng(svg, 16),
        renderPng(svg, 32),
        renderPng(svg, 48),
      ]);
      return packIco([
        { size: 16, png: png16 },
        { size: 32, png: png32 },
        { size: 48, png: png48 },
      ]);
    }
    if (variant === "180") {
      return renderPng(svg, 180, { background: DEFAULT_MARK_BACKGROUND });
    }
    if (variant === "maskable-512") {
      return renderPng(svg, 512, { maskable: true, background: DEFAULT_MARK_BACKGROUND });
    }
    return renderPng(svg, COMMUNITY_ICON_VARIANTS[variant].size);
  })();

  defaultIconCache.set(variant, rendered);
  // A failed render (a missing public/icon.svg in an odd deployment) should
  // not poison the cache forever.
  rendered.catch(() => defaultIconCache.delete(variant));
  return rendered;
}

/** The bytes a browser asks for, whether the community has uploaded an icon
 *  or not. Falling back to the Orchard mark here — rather than at every
 *  caller — is what lets the manifest and the <head> name one URL shape
 *  regardless of whether a community has branded itself. */
export async function readCommunityIcon(
  variant: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  if (!isCommunityIconVariant(variant)) return null;
  const contentType = COMMUNITY_ICON_VARIANTS[variant].contentType;

  try {
    const [row] = await db
      .select({ id: community.id, iconUpdatedAt: community.iconUpdatedAt })
      .from(community)
      .limit(1);

    if (row?.iconUpdatedAt) {
      const [stored] = await db
        .select({ bytes: communityIcon.bytes, contentType: communityIcon.contentType })
        .from(communityIcon)
        .where(
          and(
            eq(communityIcon.communityId, row.id),
            eq(communityIcon.variant, variant),
          ),
        );
      if (stored) {
        return { bytes: stored.bytes, contentType: stored.contentType };
      }
    }
  } catch {
    // An icon is not worth a broken <head> or an install prompt that never
    // appears: if the database is unreachable, serve the default mark.
  }

  return { bytes: await renderDefaultIcon(variant), contentType };
}

function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop()?.trim() || "icon.png";
  // Control characters are not useful in a change-log line, and a bounded
  // length keeps a hostile multipart filename from filling a column.
  return base.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120) || "icon.png";
}

/** Store a new app icon, replacing every variant of the old one.
 *
 *  Validated here rather than only in the action: this is also the seam a
 *  future API or import would call, and the two things that matter — that it
 *  really is a PNG, and that it is large enough to make a home-screen icon
 *  from — are properties of the image, not of the form that submitted it. */
export async function setCommunityIcon(
  actor: Member,
  input: { fileName: string; bytes: Uint8Array },
) {
  const communityRow = await getCommunity(actor);
  requireNotOnsiteLocked(communityRow);

  const source = Buffer.from(input.bytes);
  if (source.byteLength === 0) {
    throw new AppError("That file is empty — choose a PNG to upload.");
  }
  if (source.byteLength > COMMUNITY_ICON_MAX_BYTES) {
    throw new AppError("That PNG is larger than 8 MB. A smaller file is plenty for an icon.");
  }

  let metadata: { format?: string; width?: number; height?: number };
  try {
    metadata = await sharp(source, {
      limitInputPixels: MAX_SOURCE_DIMENSION * MAX_SOURCE_DIMENSION,
    }).metadata();
  } catch {
    throw new AppError("That file couldn't be read as an image. Choose a PNG.");
  }

  if (metadata.format !== "png") {
    throw new AppError("The app icon has to be a PNG. Choose a .png file.");
  }
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width === 0 || height === 0) {
    throw new AppError("That PNG has no readable size. Try exporting it again.");
  }
  if (Math.min(width, height) < COMMUNITY_ICON_MIN_DIMENSION) {
    throw new AppError(
      `That PNG is ${width}×${height}. Use one at least ${COMMUNITY_ICON_MIN_DIMENSION}×${COMMUNITY_ICON_MIN_DIMENSION} — 512×512 or larger looks best on a home screen.`,
    );
  }
  if (Math.max(width, height) > MAX_SOURCE_DIMENSION) {
    throw new AppError(`That PNG is ${width}×${height}. Use one no larger than ${MAX_SOURCE_DIMENSION}×${MAX_SOURCE_DIMENSION}.`);
  }

  const variants = await generateCommunityIcons(source, communityRow.accentPrimary);
  const fileName = cleanFileName(input.fileName);

  await db.transaction(async (tx) => {
    await tx.delete(communityIcon).where(eq(communityIcon.communityId, actor.communityId));
    await tx.insert(communityIcon).values(
      (Object.entries(variants) as [CommunityIconVariant, Buffer][]).map(([variant, bytes]) => ({
        communityId: actor.communityId,
        variant,
        bytes,
        contentType: COMMUNITY_ICON_VARIANTS[variant].contentType,
      })),
    );

    await tx
      .update(community)
      .set({ iconUpdatedAt: new Date(), iconFileName: fileName })
      .where(eq(community.id, actor.communityId));

    await recordSettingChanges(tx, {
      actor,
      entity: "community",
      action: communityRow.iconUpdatedAt ? "updated" : "created",
      entityId: actor.communityId,
      entityLabel: communityRow.name,
      current: { appIcon: communityRow.iconFileName },
      changes: { appIcon: fileName },
    });
  });
}

/** Back to the Orchard mark. Its own function rather than `setCommunityIcon`
 *  with a null, because "remove" is a real decision the change log should
 *  record and a null upload is not an image to validate. */
export async function removeCommunityIcon(actor: Member) {
  const communityRow = await getCommunity(actor);
  requireNotOnsiteLocked(communityRow);

  if (!communityRow.iconUpdatedAt) return;

  await db.transaction(async (tx) => {
    await tx.delete(communityIcon).where(eq(communityIcon.communityId, actor.communityId));
    await tx
      .update(community)
      .set({ iconUpdatedAt: null, iconFileName: null })
      .where(eq(community.id, actor.communityId));

    await recordSettingChanges(tx, {
      actor,
      entity: "community",
      action: "deleted",
      entityId: actor.communityId,
      entityLabel: communityRow.name,
      current: { appIcon: communityRow.iconFileName },
      changes: { appIcon: null },
    });
  });
}
