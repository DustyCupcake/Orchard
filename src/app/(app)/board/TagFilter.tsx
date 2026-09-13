"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { SELECT } from "@/components/ui/kit";

export default function TagFilter({
  tags,
  selectedTag,
}: {
  tags: string[];
  selectedTag?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <label className="flex items-center gap-1.5 text-[13px] text-[var(--text-muted)]">
      Tag
      <select
        defaultValue={selectedTag ?? ""}
        onChange={(e) => {
          const value = e.target.value;
          // Clone-then-override every other current param — see
          // BranchFilter's identical fix for why this replaced a
          // from-scratch URLSearchParams that used to drop fit/
          // hideCycleless/view whenever a tag was picked.
          const params = new URLSearchParams(searchParams.toString());
          if (value) params.set("tag", value);
          else params.delete("tag");
          const query = params.toString();
          router.push(query ? `/board?${query}` : "/board");
        }}
        className={SELECT}
      >
        <option value="">All tags</option>
        {tags.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    </label>
  );
}
