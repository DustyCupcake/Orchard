"use client";

import { useRouter } from "next/navigation";
import { SELECT } from "@/components/ui/kit";

export default function BranchFilter({
  branches,
  selectedBranchId,
}: {
  branches: { id: string; name: string }[];
  selectedBranchId?: string;
}) {
  const router = useRouter();

  return (
    <label className="flex items-center gap-1.5 text-[13px] text-[var(--text-muted)]">
      Branch
      <select
        defaultValue={selectedBranchId ?? ""}
        onChange={(e) => {
          const value = e.target.value;
          router.push(value ? `/board?branchId=${value}` : "/board");
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
