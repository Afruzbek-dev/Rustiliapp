import type { ReactNode } from "react";
import { BottomNav } from "@/components/student/BottomNav";
import { getSpeakHref } from "@/server/dashboard";
import { requireStudent } from "@/server/guards";

export const dynamic = "force-dynamic";

export default async function StudentLayout({ children }: { children: ReactNode }) {
  const { user } = await requireStudent();
  const speakHref = await getSpeakHref(user.id);
  return (
    <div className="min-h-dvh pb-24">
      <div className="mx-auto w-full max-w-xl">{children}</div>
      <BottomNav speakHref={speakHref} />
    </div>
  );
}
