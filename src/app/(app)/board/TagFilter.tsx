"use client";

import { useRouter } from "next/navigation";

export default function TagFilter({
  tags,
  selectedTag,
  branchId,
}: {
  tags: string[];
  selectedTag?: string;
  branchId?: string;
}) {
  const router = useRouter();

  return (
    <label>
      Tag:{" "}
      <select
        defaultValue={selectedTag ?? ""}
        onChange={(e) => {
          const value = e.target.value;
          const params = new URLSearchParams();
          if (branchId) params.set("branchId", branchId);
          if (value) params.set("tag", value);
          const query = params.toString();
          router.push(query ? `/board?${query}` : "/board");
        }}
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
