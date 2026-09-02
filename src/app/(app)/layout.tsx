import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/session";
import { getNavContext } from "@/lib/nav";
import AppShell from "@/components/nav/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const currentMember = await getCurrentMember();
  if (!currentMember) {
    redirect("/login");
  }

  const ctx = await getNavContext(currentMember);

  return <AppShell ctx={ctx}>{children}</AppShell>;
}
