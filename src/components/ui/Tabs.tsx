import Link from "next/link";

// The underline `?tab=` tab bar — previously hand-duplicated (identical
// border-b-2/accent-1-active markup) as a local TabBar in both
// settings/page.tsx and tasks/[id]/page.tsx. Zero-JS by design: every
// tab is a plain <Link>, active tab decided server-side from
// searchParams, content conditionally rendered off that — no client
// component needed since nothing here is stateful beyond the URL.
export default function Tabs<T extends string>({
  tabs,
  active,
  hrefFor,
}: {
  tabs: readonly { key: T; label: string }[];
  active: T;
  hrefFor: (key: T) => string;
}) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 border-b border-[var(--border)]">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={hrefFor(t.key)}
          className={`border-b-2 pb-2.5 text-[13px] font-medium transition-colors ${
            active === t.key
              ? "border-[var(--accent-1)] text-[var(--accent-1)]"
              : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
