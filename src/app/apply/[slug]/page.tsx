import ApplyView from "../ApplyView";

export const dynamic = "force-dynamic";

// A public lane with its own address (docs/admission-flow.md §2a): another
// starting point with its own process, served at /apply/<slug>.
export default async function ApplyLanePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Parameters<typeof ApplyView>[0]["searchParams"];
}) {
  const { slug } = await params;
  return <ApplyView searchParams={searchParams} slug={slug} />;
}
