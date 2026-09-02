import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/session";
import { getVisibleContribution } from "@/lib/contribution";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import ContributionCategories from "@/components/ContributionCategories";

export const dynamic = "force-dynamic";

export default async function MemberContributionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const currentMember = await getCurrentMember();
  if (!currentMember) {
    redirect("/login");
  }

  const { id } = await params;
  if (id === currentMember.id) {
    redirect("/contribution");
  }

  let result: Awaited<ReturnType<typeof getVisibleContribution>> | null = null;
  let error: string | null = null;
  try {
    result = await getVisibleContribution(currentMember, id);
  } catch (err) {
    if (err instanceof ForbiddenError || err instanceof NotFoundError) {
      error = err.message;
    } else {
      throw err;
    }
  }

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 640 }}>
      <p>
        <Link href="/contribution" style={{ color: "inherit" }}>
          ← Back to your contribution
        </Link>
      </p>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {result && (
        <>
          <h1>{result.memberName}&rsquo;s contribution</h1>
          <ContributionCategories categories={result.categories} />
        </>
      )}
    </main>
  );
}
