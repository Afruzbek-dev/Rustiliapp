import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <main role="status" className="flex flex-col gap-4 p-4">
      <span className="sr-only">Yuklanmoqda</span>
      <Skeleton height="h-11" width="w-48" />
      <Skeleton height="h-2" />
      <Skeleton height="h-80" />
    </main>
  );
}
