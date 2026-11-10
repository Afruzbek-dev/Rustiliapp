import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <main role="status" className="flex flex-col gap-4 p-4">
      <span className="sr-only">Yuklanmoqda</span>
      <Skeleton height="h-8" width="w-48" />
      <div className="flex gap-2">
        <Skeleton height="h-24" />
        <Skeleton height="h-24" />
        <Skeleton height="h-24" />
      </div>
      <Skeleton height="h-14" />
      <Skeleton height="h-40" />
      <Skeleton height="h-40" />
      <Skeleton height="h-20" />
    </main>
  );
}
