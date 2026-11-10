import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <main role="status" className="bg-grid flex min-h-dvh flex-col items-center gap-6 p-4">
      <span className="sr-only">Yuklanmoqda</span>
      <Skeleton height="h-28" />
      <Skeleton height="h-20" width="w-20" />
      <Skeleton height="h-20" width="w-20" />
      <Skeleton height="h-20" width="w-20" />
    </main>
  );
}
