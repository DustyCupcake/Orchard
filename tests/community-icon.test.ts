import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { db } from "@/db";
import { community, communityIcon, settingsChange } from "@/db/schema";
import {
  COMMUNITY_ICON_VARIANTS,
  generateCommunityIcons,
  isCommunityIconVariant,
  readCommunityIcon,
  removeCommunityIcon,
  setCommunityIcon,
} from "@/lib/settings/community-icon";
import { createFixtures, resetDatabase } from "./helpers";

async function png(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 24, g: 104, b: 79, alpha: 0.8 },
    },
  })
    .png()
    .toBuffer();
}

const sizeOf = async (bytes: Buffer) => {
  const metadata = await sharp(bytes).metadata();
  return { width: metadata.width, height: metadata.height, format: metadata.format };
};

describe("community app icons", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("generates every size the tab, home screen and install prompt need", async () => {
    const variants = await generateCommunityIcons(await png(512, 512), "#3a6cd9");

    expect(Object.keys(variants).sort()).toEqual(Object.keys(COMMUNITY_ICON_VARIANTS).sort());
    expect(await sizeOf(variants["16"])).toMatchObject({ width: 16, height: 16, format: "png" });
    expect(await sizeOf(variants["32"])).toMatchObject({ width: 32, height: 32, format: "png" });
    expect(await sizeOf(variants["48"])).toMatchObject({ width: 48, height: 48, format: "png" });
    expect(await sizeOf(variants["180"])).toMatchObject({ width: 180, height: 180, format: "png" });
    expect(await sizeOf(variants["192"])).toMatchObject({ width: 192, height: 192, format: "png" });
    expect(await sizeOf(variants["512"])).toMatchObject({ width: 512, height: 512, format: "png" });
    expect(await sizeOf(variants["maskable-512"])).toMatchObject({ width: 512, height: 512, format: "png" });

    // An ICO is a 6-byte header, a 16-byte entry per image, then PNG data.
    const ico = variants["favicon.ico"];
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(3);
    expect(ico.subarray(6, 22).readUInt32LE(8)).toBe(variants["16"].length);
    expect(ico.subarray(0, 6 + 3 * 16).length).toBe(54);
  });

  it("flattens and pads the phone-home-screen variants onto the accent", async () => {
    const accent = "#3a6cd9";
    const variants = await generateCommunityIcons(await png(512, 512), accent);

    // iOS paints transparent pixels black; an Apple touch icon must have no
    // alpha at all. The same applies to a maskable icon before its padding.
    expect((await sharp(variants["180"]).metadata()).hasAlpha).toBe(false);
    expect((await sharp(variants["maskable-512"]).metadata()).hasAlpha).toBe(false);
    expect((await sharp(variants["512"]).metadata()).hasAlpha).toBe(true);

    // The maskable safe zone is the central 80%: sample its corner, which
    // must be the flat accent rather than the uploaded mark.
    const { data, info } = await sharp(variants["maskable-512"]).raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => {
      const offset = (y * info.width + x) * info.channels;
      return [data[offset], data[offset + 1], data[offset + 2]];
    };
    expect(at(1, 1)).toEqual([0x3a, 0x6c, 0xd9]);
    expect(at(256, 256)).not.toEqual([0x3a, 0x6c, 0xd9]);
  });

  it("stores the whole set transactionally and records the change", async () => {
    const { community: c, alice } = await createFixtures();

    await setCommunityIcon(alice, { fileName: "brand.png", bytes: await png(512, 512) });

    const [row] = await db.select().from(community).where(eq(community.id, c.id));
    expect(row.iconFileName).toBe("brand.png");
    expect(row.iconUpdatedAt).toBeInstanceOf(Date);

    const rows = await db.select().from(communityIcon).where(eq(communityIcon.communityId, c.id));
    expect(rows).toHaveLength(Object.keys(COMMUNITY_ICON_VARIANTS).length);
    expect(new Set(rows.map((r) => r.variant))).toEqual(new Set(Object.keys(COMMUNITY_ICON_VARIANTS)));
    expect(rows.every((r) => r.bytes.length > 0)).toBe(true);
    expect(rows.find((r) => r.variant === "favicon.ico")?.contentType).toBe("image/x-icon");

    const served = await readCommunityIcon("180");
    expect(served?.contentType).toBe("image/png");
    expect(served?.bytes).toEqual(rows.find((r) => r.variant === "180")?.bytes);

    const changes = await db
      .select()
      .from(settingsChange)
      .where(eq(settingsChange.communityId, c.id));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      field: "appIcon",
      oldValue: null,
      newValue: "brand.png",
      actorId: alice.id,
    });
  });

  it("replaces an existing set and cleans the uploaded file name", async () => {
    const { community: c, alice } = await createFixtures();
    await setCommunityIcon(alice, { fileName: "old.png", bytes: await png(512, 512) });
    const [before] = await db.select().from(community).where(eq(community.id, c.id));

    await setCommunityIcon(alice, {
      fileName: "../../evil\u0000-name.png",
      bytes: await png(256, 256),
    });

    const rows = await db.select().from(communityIcon).where(eq(communityIcon.communityId, c.id));
    expect(rows).toHaveLength(Object.keys(COMMUNITY_ICON_VARIANTS).length);
    const [after] = await db.select().from(community).where(eq(community.id, c.id));
    expect(after.iconFileName).toBe("evil-name.png");
    expect(after.iconUpdatedAt!.getTime()).toBeGreaterThanOrEqual(before.iconUpdatedAt!.getTime());
  });

  it("falls back to the Orchard mark before an upload and after removal", async () => {
    const { community: c, alice } = await createFixtures();

    const before = await readCommunityIcon("192");
    expect(before?.bytes.length).toBeGreaterThan(0);
    expect((await sharp(before!.bytes).metadata()).format).toBe("png");
    expect(await readCommunityIcon("not-a-variant")).toBeNull();

    await setCommunityIcon(alice, { fileName: "brand.png", bytes: await png(512, 512) });
    const custom = await readCommunityIcon("192");
    await removeCommunityIcon(alice);

    const after = await readCommunityIcon("192");
    expect(after?.bytes).toEqual(before?.bytes);
    expect(after?.bytes).not.toEqual(custom?.bytes);
    expect(await db.select().from(communityIcon).where(eq(communityIcon.communityId, c.id))).toHaveLength(0);

    const [row] = await db.select().from(community).where(eq(community.id, c.id));
    expect(row.iconUpdatedAt).toBeNull();
    expect(row.iconFileName).toBeNull();
  });

  it("rejects files that cannot make a home-screen icon", async () => {
    const { alice } = await createFixtures();

    await expect(
      setCommunityIcon(alice, { fileName: "tiny.png", bytes: await png(32, 32) }),
    ).rejects.toThrow(/at least 64/);
    await expect(
      setCommunityIcon(alice, { fileName: "empty.png", bytes: new Uint8Array() }),
    ).rejects.toThrow(/empty/);
    await expect(
      setCommunityIcon(alice, { fileName: "not-an-image.png", bytes: Buffer.from("hello") }),
    ).rejects.toThrow(/Choose a PNG/);
    await expect(
      setCommunityIcon(alice, {
        fileName: "photo.jpg",
        bytes: await sharp({ create: { width: 512, height: 512, channels: 3, background: "red" } })
          .jpeg()
          .toBuffer(),
      }),
    ).rejects.toThrow(/has to be a PNG/);
  });

  it("keeps the variant vocabulary closed", () => {
    expect(isCommunityIconVariant("favicon.ico")).toBe(true);
    expect(isCommunityIconVariant("maskable-512")).toBe(true);
    expect(isCommunityIconVariant("constructor")).toBe(false);
    expect(isCommunityIconVariant("__proto__")).toBe(false);
  });
});
