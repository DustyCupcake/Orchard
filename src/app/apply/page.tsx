import ApplyView from "./ApplyView";

export const dynamic = "force-dynamic";

// The first public lane (docs/plans/admission-flow.md §2a). Other public lanes are
// served at /apply/<slug>.
export default function ApplyPage({
  searchParams,
}: {
  searchParams: Parameters<typeof ApplyView>[0]["searchParams"];
}) {
  return <ApplyView searchParams={searchParams} slug={null} />;
}
