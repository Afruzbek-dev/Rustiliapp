import type { ReactNode } from "react";
import { Sidebar } from "@/components/staff/Sidebar";
import { pendingQueueCount, requireShellUser } from "@/server/staff-shell";

export const dynamic = "force-dynamic";

export default async function StaffLayout({ children }: { children: ReactNode }) {
  const user = await requireShellUser();
  const pending = await pendingQueueCount();
  return (
    <div className="flex min-h-dvh flex-wrap">
      <Sidebar role={user.role} name={user.name} pending={pending} />
      <div className="min-w-0 flex-[999_1_560px]">{children}</div>
    </div>
  );
}
