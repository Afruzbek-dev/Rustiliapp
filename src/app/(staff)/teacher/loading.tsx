import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <main role="status" className="flex flex-col gap-4 p-4">
      <span className="sr-only">Yuklanmoqda</span>
      <Skeleton height="h-8" width="w-40" />
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr))]">
        <Skeleton height="h-28" />
        <Skeleton height="h-28" />
        <Skeleton height="h-28" />
        <Skeleton height="h-28" />
      </div>
      <Skeleton height="h-64" />
      <Skeleton height="h-40" />
      <Skeleton height="h-40" />
    </main>
  );
}
