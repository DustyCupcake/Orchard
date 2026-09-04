import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { getVisibleContribution } from "@/lib/contribution";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import ContributionCategories from "@/components/ContributionCategories";
import { Banner } from "@/components/ui/kit";

export const dynamic = "force-dynamic";

export default async function MemberContributionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { id } = await params;
  if (id === viewing.id) {
    redirect("/contribution");
  }

  let result: Awaited<ReturnType<typeof getVisibleContribution>> | null = null;
  let error: string | null = null;
  try {
    result = await getVisibleContribution(viewing, id);
  } catch (err) {
    if (err instanceof ForbiddenError || err instanceof NotFoundError) {
      error = err.message;
    } else {
      throw err;
    }
  }

  return (
    <main className="mx-auto max-w-[720px] px-6 py-10 md:px-12 md:py-14">
      <Link href="/contribution" className="text-[13px] font-medium text-[var(--accent-1)] hover:underline">
        ← Back to your contribution
      </Link>

      {error && <div className="mt-4"><Banner tone="danger">{error}</Banner></div>}

      {result && (
        <>
          <h1 className="mt-4 text-[32px] font-semibold leading-tight text-[var(--text)]">
            {result.memberName}&rsquo;s contribution
          </h1>
          <div className="mt-4">
            <ContributionCategories categories={result.categories} />
          </div>
        </>
      )}
    </main>
  );
}
