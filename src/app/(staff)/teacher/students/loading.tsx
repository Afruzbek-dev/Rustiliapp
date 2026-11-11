import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <main role="status" className="flex flex-col gap-4 p-4">
      <span className="sr-only">Yuklanmoqda</span>
      <Skeleton height="h-8" width="w-40" />
      <Skeleton height="h-12" />
      <Skeleton height="h-64" />
    </main>
  );
}
