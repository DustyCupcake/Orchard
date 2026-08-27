"use client";

import { useRouter } from "next/navigation";

export default function BranchFilter({
  branches,
  selectedBranchId,
}: {
  branches: { id: string; name: string }[];
  selectedBranchId?: string;
}) {
  const router = useRouter();

  return (
    <label>
      Branch:{" "}
      <select
        defaultValue={selectedBranchId ?? ""}
        onChange={(e) => {
          const value = e.target.value;
          router.push(value ? `/board?branchId=${value}` : "/board");
        }}
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
