import type { ReactNode } from "react";

// The shared top-of-page frame: title + context on the left, action
// buttons on the right, an optional tab strip underneath. See
// docs/design_handoff_conventions/README.md's Styling progress note —
// every page was restyled onto tokens but none were re-laid-out, so
// each one built its own ad hoc title/meta/action arrangement. This is
// the first shared shape; only /calendar and the Task interface
// (/board, /tasks/[id]) use it so far — rolling it out further is
// deliberately left as follow-up work, not done in this pass.
export default function PageHeader({
  title,
  description,
  actions,
  tabs,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
}) {
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">{title}</h1>
          {description && <div className="mt-2 text-[13px] text-[var(--text-muted)]">{description}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {tabs && <div className="mt-5">{tabs}</div>}
    </div>
  );
}
