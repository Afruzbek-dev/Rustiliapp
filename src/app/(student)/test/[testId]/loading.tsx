import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <main role="status" className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 p-4">
      <span className="sr-only">Yuklanmoqda</span>
      <Skeleton height="h-8" width="w-2/3" />
      <Skeleton height="h-40" />
      <Skeleton height="h-12" />
    </main>
  );
}
