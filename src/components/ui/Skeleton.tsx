import { cn } from "./cn";

export function Skeleton({
  height = "h-4",
  width = "w-full",
}: {
  height?: string;
  width?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-[var(--radius-sm)] bg-surface-2", height, width)}
    />
  );
}
