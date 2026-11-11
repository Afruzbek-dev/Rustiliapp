import { Hourglass } from "lucide-react";
import { EmptyState } from "@/components/ui";
import { requireStaff } from "@/server/guards";

export const dynamic = "force-dynamic";

/**
 * Placeholder for staff sections that are not built yet (lessons, students, curators, tests, rating,
 * settings): keeps the navigation free of 404s. Real pages take precedence as they are added.
 */
export default async function ComingSoonPage() {
  await requireStaff();
  return (
    <main className="p-4">
      <EmptyState
        icon={<Hourglass className="size-10" />}
        title="Tez orada"
        text="Bu bo'lim ustida ish olib borilmoqda."
      />
    </main>
  );
}
