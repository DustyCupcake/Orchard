import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { listBranches, listCycleTypes } from "@/lib/settings";
import {
  getTaskPack,
  previewPackImportBranches,
  previewPackImportDates,
} from "@/lib/task-packs";
import { NotFoundError } from "@/lib/errors";
import { ClonePreviewGrid, ClonePreviewList } from "@/components/ClonePreview";
import { decodeImportState } from "./state";
import { finalizePackImportAction, reviewPackImportAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ImportTaskPackPage({
  params,
  searchParams,
}: {
  params: Promise<{ packId: string }>;
  searchParams: Promise<{
    error?: string;
    stage?: string;
    state?: string;
    cycleTypeId?: string;
    cycleName?: string;
    previewStart?: string;
    previewEnd?: string;
    previewView?: string;
  }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { packId } = await params;
  const {
    error,
    stage,
    state: stateRaw,
    cycleTypeId: qCycleTypeId,
    cycleName: qCycleName,
    previewStart,
    previewEnd,
    previewView,
  } = await searchParams;

  let loaded: Awaited<ReturnType<typeof getTaskPack>>;
  try {
    loaded = await getTaskPack(viewing, packId);
  } catch (err) {
    if (err instanceof NotFoundError) {
      return (
        <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem" }}>
          <p>
            <Link href="/task-packs">← Back to Task Packs</Link>
          </p>
          <p style={{ color: "crimson" }}>Task Pack not found.</p>
        </main>
      );
    }
    throw err;
  }
  const { pack, items } = loaded;

  const decodedState = stateRaw ? decodeImportState(stateRaw) : null;

  if (stage === "reassign" && decodedState) {
    const declinedItems = items.filter((i) => decodedState.declinedHints.includes(i.branchNameHint));
    const branches = await listBranches(viewing);
    const declinedItemIds = declinedItems.map((i) => i.id);

    return (
      <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 640 }}>
        <p>
          <Link href="/task-packs">← Back to Task Packs</Link>
        </p>
        <h1>Reassign declined branches — {pack.name}</h1>
        {error && <p style={{ color: "crimson" }}>{error}</p>}
        <p style={{ color: "#666", fontSize: "0.85rem" }}>
          You declined creating a branch for {decodedState.declinedHints.map((h) => `"${h}"`).join(", ")}.
          Every task that would have landed there needs a real, existing branch instead — nothing
          from Screen One has been created yet.
        </p>

        <form action={finalizePackImportAction} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <input type="hidden" name="packId" value={packId} />
          <input type="hidden" name="state" value={stateRaw} />
          <input type="hidden" name="declinedItemIds" value={JSON.stringify(declinedItemIds)} />

          {declinedItems.map((item) => (
            <label key={item.id} style={{ display: "block", fontSize: "0.9rem" }}>
              {item.title} <span style={{ color: "#666" }}>(was &ldquo;{item.branchNameHint}&rdquo;)</span>
              <br />
              <select name={`itemBranch__${item.id}`} required defaultValue="" style={{ padding: "0.3rem" }}>
                <option value="" disabled>
                  Pick a branch
                </option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          ))}

          <button type="submit" style={{ padding: "0.4rem 1rem", width: "fit-content" }}>
            Confirm import
          </button>
        </form>
      </main>
    );
  }

  const [branchSuggestions, cycleTypes, existingBranches] = await Promise.all([
    previewPackImportBranches(viewing, packId),
    listCycleTypes(viewing),
    listBranches(viewing),
  ]);
  const preview =
    previewStart || previewEnd
      ? await previewPackImportDates(viewing, packId, previewStart || null, previewEnd || null)
      : null;
  const distinctHints = branchSuggestions.map((s) => s.hint);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 640 }}>
      <p>
        <Link href="/task-packs">← Back to Task Packs</Link>
      </p>
      <h1>Import &ldquo;{pack.name}&rdquo;</h1>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {pack.description && <p style={{ color: "#666" }}>{pack.description}</p>}

      <section style={{ border: "1px solid #ddd", borderRadius: 6, padding: "1rem", marginBottom: "1rem" }}>
        <h3 style={{ marginTop: 0, fontSize: "0.95rem" }}>Preview resolved dates</h3>
        <p style={{ color: "#666", fontSize: "0.85rem" }}>
          See what this pack&rsquo;s phase spine and task milestones would resolve to against a
          hypothetical start/end, before committing to anything.
        </p>
        <form method="get" style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "flex-end" }}>
          <label style={{ fontSize: "0.85rem" }}>
            Hypothetical start
            <br />
            <input type="date" name="previewStart" defaultValue={previewStart ?? ""} style={{ padding: "0.4rem" }} />
          </label>
          <label style={{ fontSize: "0.85rem" }}>
            Hypothetical end
            <br />
            <input type="date" name="previewEnd" defaultValue={previewEnd ?? ""} style={{ padding: "0.4rem" }} />
          </label>
          <label style={{ fontSize: "0.85rem" }}>
            View
            <br />
            <select name="previewView" defaultValue={previewView ?? "grid"} style={{ padding: "0.4rem" }}>
              <option value="grid">Calendar</option>
              <option value="list">List</option>
            </select>
          </label>
          <button type="submit" style={{ padding: "0.4rem 1rem" }}>
            Preview
          </button>
        </form>
        {preview &&
          (previewView === "list" ? <ClonePreviewList preview={preview} /> : <ClonePreviewGrid preview={preview} />)}
      </section>

      <form action={reviewPackImportAction} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <input type="hidden" name="packId" value={packId} />
        <input type="hidden" name="hints" value={JSON.stringify(distinctHints)} />

        <label>
          New cycle name
          <br />
          <input
            type="text"
            name="cycleName"
            required
            defaultValue={qCycleName ?? pack.name}
            style={{ padding: "0.4rem", width: "100%" }}
          />
        </label>

        {cycleTypes.length > 0 && (
          <label>
            Cycle type (optional)
            <br />
            <select name="cycleTypeId" defaultValue={qCycleTypeId ?? ""} style={{ padding: "0.4rem", width: "100%" }}>
              <option value="">No cycle type</option>
              {cycleTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div>
          <h3 style={{ fontSize: "0.95rem" }}>Branches</h3>
          <p style={{ color: "#666", fontSize: "0.85rem" }}>
            Each of this pack&rsquo;s branch names, matched against your own — remap to any existing
            branch, force a new one even where a match was found, or decline (you&rsquo;ll pick a
            real branch per task on the next screen instead).
          </p>
          {branchSuggestions.map(({ hint, suggestedBranchId }) => (
            <label key={hint} style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.9rem" }}>
              &ldquo;{hint}&rdquo;
              <br />
              <select
                name={`resolution__${hint}`}
                defaultValue={suggestedBranchId ?? "__create_new__"}
                style={{ padding: "0.3rem" }}
              >
                <option value="__create_new__">Create new branch &ldquo;{hint}&rdquo;</option>
                <option value="__decline__">Decline — reassign each task individually</option>
                {existingBranches.map((b) => (
                  <option key={b.id} value={b.id}>
                    Use existing: {b.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>

        <button type="submit" style={{ padding: "0.4rem 1rem", width: "fit-content" }}>
          Continue
        </button>
      </form>
    </main>
  );
}
