import { describe, expect, it } from "vitest";
import { NAV_GROUPS, isNavGroupRenderable } from "@/components/nav/nav-config";

describe("navigation group visibility", () => {
  it("keeps the header-only Library destination renderable", () => {
    const library = NAV_GROUPS.find((group) => group.key === "library");

    expect(library).toMatchObject({
      label: "Library",
      href: "/documentation",
      headerIsLink: true,
      items: [],
    });
    expect(isNavGroupRenderable(library!)).toBe(true);
  });

  it("does not render an empty ordinary group", () => {
    const library = NAV_GROUPS.find((group) => group.key === "library")!;
    expect(isNavGroupRenderable({ ...library, headerIsLink: false })).toBe(false);
  });
});
