"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { SELECT } from "@/components/ui/kit";

export default function BranchFilter({
  branches,
  selectedBranchId,
}: {
  branches: { id: string; name: string }[];
  selectedBranchId?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <label className="flex items-center gap-1.5 text-[13px] text-[var(--text-muted)]">
      Branch
      <select
        defaultValue={selectedBranchId ?? ""}
        onChange={(e) => {
          const value = e.target.value;
          // Clone-then-override every other current param — a plain
          // `?branchId=` overwrite here used to silently drop tag/fit/
          // hideCycleless/view whenever a branch was picked.
          const params = new URLSearchParams(searchParams.toString());
          if (value) params.set("branchId", value);
          else params.delete("branchId");
          const query = params.toString();
          router.push(query ? `/board?${query}` : "/board");
        }}
        className={SELECT}
      >
        <option value="">All branches</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </label>
  );
}
