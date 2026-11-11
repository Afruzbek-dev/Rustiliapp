import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <main role="status" className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <span className="sr-only">Yuklanmoqda</span>
      <div className="flex items-center justify-between">
        <Skeleton height="h-8" width="w-52" />
        <Skeleton height="h-8" width="w-10" />
      </div>
      <Skeleton height="h-48" />
      <Skeleton height="h-56" />
      <Skeleton height="h-14" />
    </main>
  );
}
