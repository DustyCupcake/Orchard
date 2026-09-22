"use client";

import { useRouter } from "next/navigation";

export default function FilterSelect({
  value,
  options,
  param,
  placeholder,
}: {
  value: string | undefined;
  options: { value: string; label: string }[];
  param: string;
  placeholder: string;
}) {
  const router = useRouter();

  return (
    <select
      name={param}
      className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[13px]"
      value={value ?? ""}
      onChange={(e) => {
        const val = e.target.value;
        const url = new URL(window.location.href);
        if (val) {
          url.searchParams.set(param, val);
        } else {
          url.searchParams.delete(param);
        }
        router.push(url.pathname + url.search);
      }}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
