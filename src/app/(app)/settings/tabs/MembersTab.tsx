import Link from "next/link";
import { Banner, BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT, LABEL } from "@/components/ui/kit";
import { SettingsSection } from "../ui";
import { confirmBulkMemberImportAction, reviewBulkMemberImportAction } from "../actions";
import { decodeBulkMemberState } from "../bulk-members-state";

// Admin-only, and not because the content is sensitive — because this is
// an *action*, not a setting anybody deliberates about. Every other tab
// is configuration a member has a stake in reading; pasting a roster is
// a one-off import somebody does on the community's behalf.
//
// The old version of this tab was the one place on the settings screen
// whose state lived in the URL (bulkState), which meant a review in
// progress was a URL you could lose by refreshing. It still is, because
// the review has to survive a redirect through a form post — but the copy
// now says so, and the review screen says what will happen before it
// happens rather than after.
export default function MembersTab({
  bulkStateRaw,
  bulkAdded,
}: {
  bulkStateRaw?: string;
  bulkAdded?: string;
}) {
  const state = bulkStateRaw ? decodeBulkMemberState(bulkStateRaw) : null;

  return (
    <SettingsSection
      title="Bulk-add members"
      description="Paste or upload a list to create member accounts in one go. This is a one-off import for getting a community's existing roster in — afterwards, people are added one at a time, or by an invite."
    >
      {bulkAdded && (
        <Banner tone="success">
          {bulkAdded} member{bulkAdded === "1" ? "" : "s"} created. They can sign in with a magic
          link once they have an email address on the record.
        </Banner>
      )}

      {state ? (
        <>
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="text-[15px] font-medium text-[var(--text)]">Will be created</h3>
              {state.newRows.length === 0 ? (
                <p className="mt-1 text-[13px] text-[var(--text-muted)]">Nothing — everyone is already here.</p>
              ) : (
                <ul className="mt-1 list-inside list-disc text-[13px] text-[var(--text-muted)]">
                  {state.newRows.map((r) => (
                    <li key={`${r.name}-${r.email}`}>
                      {r.name} — {r.email}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="text-[15px] font-medium text-[var(--text)]">Already a member, skipped</h3>
              {state.alreadyExistsRows.length === 0 ? (
                <p className="mt-1 text-[13px] text-[var(--text-muted)]">None.</p>
              ) : (
                <ul className="mt-1 list-inside list-disc text-[13px] text-[var(--text-muted)]">
                  {state.alreadyExistsRows.map((r) => (
                    <li key={r.email}>{r.email}</li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="text-[15px] font-medium text-[var(--text)]">Couldn&rsquo;t parse, skipped</h3>
              {state.malformedLines.length === 0 ? (
                <p className="mt-1 text-[13px] text-[var(--text-muted)]">None.</p>
              ) : (
                <ul className="mt-1 list-inside list-disc text-[13px] text-[var(--text-muted)]">
                  {state.malformedLines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <p className="text-[12px] text-[var(--text-muted)]">
            Nothing has been created yet. This review lives in the page&rsquo;s address, so don&rsquo;t
            close the tab if you want to come back to it.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <form action={confirmBulkMemberImportAction}>
              <input type="hidden" name="state" value={bulkStateRaw} />
              <button type="submit" className={BUTTON_PRIMARY} disabled={state.newRows.length === 0}>
                Create {state.newRows.length} member{state.newRows.length === 1 ? "" : "s"}
              </button>
            </form>
            <Link href="/settings?tab=members" className={BUTTON_SECONDARY}>
              Start over
            </Link>
          </div>
        </>
      ) : (
        <form
          action={reviewBulkMemberImportAction}
          className="flex max-w-[560px] flex-col gap-2"
          encType="multipart/form-data"
        >
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Paste rows — one per line, name then email separated by a comma</span>
            <textarea name="pastedText" rows={6} className={INPUT} placeholder="Alex Doyle, alex@example.com" />
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>…or upload a CSV</span>
            <input type="file" name="file" accept=".csv,text/csv,text/plain" className={INPUT} />
          </label>
          <p className="text-[12px] text-[var(--text-muted)]">
            Nothing is created until you&rsquo;ve seen exactly who will be and confirmed it.
          </p>
          <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
            Preview the import
          </button>
        </form>
      )}
    </SettingsSection>
  );
}
