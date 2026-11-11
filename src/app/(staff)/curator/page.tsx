import { notFound } from "next/navigation";
import type { QueueItem } from "@/lib/curator-types";
import { ReviewQueue } from "@/components/staff/ReviewQueue";
import { getQueue, getSubmission, isStaffRole, recentlyReviewed } from "@/server/curator-queue";
import { requireReviewer } from "@/server/guards";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CuratorPage({ searchParams }: { searchParams: Promise<{ s?: string | string[] }> }) {
  const { user, role } = await requireReviewer();
  const sp = await searchParams;
  const s = Array.isArray(sp.s) ? sp.s[0] : sp.s;
  const staff = isStaffRole(role);

  // deep link: pending or reviewed, 404 when invisible / unfinished / a test item
  let linked: QueueItem | null = null;
  if (s !== undefined) {
    if (!UUID.test(s)) notFound();
    linked = await getSubmission(user.id, s);
    if (!linked) notFound();
  }

  const [queue, reviewed] = await Promise.all([getQueue(user.id), staff ? recentlyReviewed(user.id) : Promise.resolve([])]);

  let items = queue.items;
  let openId: string | null = null;
  let tab: "queue" | "reviewed" = "queue";
  let pinned: QueueItem | null = null;
  let reviewedList = reviewed;
  if (linked?.status === "pending") {
    items = [linked, ...items.filter((i) => i.id !== linked.id)];
  } else if (linked) {
    if (staff) {
      tab = "reviewed";
      openId = linked.id;
      if (!reviewedList.some((r) => r.id === linked.id)) reviewedList = [linked, ...reviewedList];
    } else {
      pinned = linked;
    }
  }

  return (
    <ReviewQueue
      initialItems={items}
      reviewed={reviewedList}
      canOverride={staff}
      nowIso={new Date().toISOString()}
      initialTab={tab}
      initialOpenId={openId}
      pinned={pinned}
    />
  );
}
