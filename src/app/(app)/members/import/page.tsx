import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { isAdmin } from "@/lib/settings/admins";
import { Banner, BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT, LABEL } from "@/components/ui/kit";
import { SettingsSection } from "../../settings/ui";
import { confirmBulkMemberImportAction, reviewBulkMemberImportAction } from "./actions";
import { decodeBulkMemberState } from "./state";

export const dynamic = "force-dynamic";

/**
 * The roster import, off /settings and onto the member directory.
 *
 * It was the Admin-only Members tab, which was the right call on the
 * reasoning that it is an *action* rather than a setting anybody
 * deliberates about — and that reasoning was right while the tab lived on
 * the settings screen, where it sat as the eleventh tab of configuration
 * nobody opens twice. It is not a thing you configure; it is a thing you
 * do once, to a list you already have. So it now lives where the list it
 * changes is, behind one link from the directory, and the settings screen
 * has ten tabs of actual configuration.
 *
 * The flow is unchanged: parse, preview exactly who will be created and
 * who will be skipped, then confirm. The review state still round-trips
 * through the URL as base64url, because it has to survive a redirect
 * through a form post and the alternative is a staging table for a flow
 * that runs once — the same trade Task Pack import already makes in
 * src/app/(app)/task-packs/import/[packId]/state.ts.
 */
export default async function BulkImportPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; bulkStage?: string; bulkState?: string; bulkAdded?: string }>;
}) {
  const { real, viewing, viewAs } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  // Admin-only, and a hard redirect rather than a 403: the route is
  // linked from the directory, and a member who guesses the URL should get
  // the directory back rather than a page saying no. `isAdmin` rather than
  // `requireAdmins` for the same reason — the actions below are the gate
  // that matters, and this only decides whether to render a link.
  const allowed = viewAs ? false : await isAdmin(viewing);
  if (!allowed) {
    redirect("/members");
  }

  const { error, bulkStage, bulkState, bulkAdded } = await searchParams;
  const state = bulkStage === "review" && bulkState ? decodeBulkMemberState(bulkState) : null;

  return (
    <main className="mx-auto max-w-[640px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Import members</h1>
      <p className="mt-1 text-[13px] text-[var(--text-muted)]">
        <Link href="/members" className="text-[var(--accent-1)] hover:underline">
          ← Members
        </Link>
      </p>

      {error && (
        <div className="mt-4">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      <div className="mt-6">
        <SettingsSection
          title={state ? "Review the import" : "Paste or upload a list"}
          description={
            state
              ? "Nobody is created until you confirm."
              : "One row per line: a name, then an email address. Creates member accounts in one go — a one-off for a community's existing roster, since afterwards people are added one at a time or by an invite."
          }
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
                  <h3 className="text-[15px] font-medium text-[var(--text)]">
                    Will be created ({state.newRows.length})
                  </h3>
                  {state.newRows.length === 0 ? (
                    <p className="mt-1 text-[13px] text-[var(--text-muted)]">
                      Nobody — everyone is already a member.
                    </p>
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
                  <h3 className="text-[15px] font-medium text-[var(--text)]">
                    Already a member, skipped ({state.alreadyExistsRows.length})
                  </h3>
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
                {state.malformedLines.length > 0 && (
                  <div>
                    <h3 className="text-[15px] font-medium text-[var(--text)]">
                      Couldn&rsquo;t read, skipped ({state.malformedLines.length})
                    </h3>
                    <ul className="mt-1 list-inside list-disc text-[13px] text-[var(--text-muted)]">
                      {state.malformedLines.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <p className="text-[12px] text-[var(--text-muted)]">
                The review lives in this page&rsquo;s address, so coming back needs the tab open.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <form action={confirmBulkMemberImportAction}>
                  <input type="hidden" name="state" value={bulkState} />
                  <button type="submit" className={BUTTON_PRIMARY} disabled={state.newRows.length === 0}>
                    Create {state.newRows.length} member{state.newRows.length === 1 ? "" : "s"}
                  </button>
                </form>
                <Link href="/members/import" className={BUTTON_SECONDARY}>
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
                <span className={LABEL}>Paste rows — name, then email</span>
                <textarea name="pastedText" rows={6} className={INPUT} placeholder="Alex Doyle, alex@example.com" />
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>…or upload a CSV</span>
                <input type="file" name="file" accept=".csv,text/csv,text/plain" className={INPUT} />
              </label>
              <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                Preview the import
              </button>
            </form>
          )}
        </SettingsSection>
      </div>
    </main>
  );
}
