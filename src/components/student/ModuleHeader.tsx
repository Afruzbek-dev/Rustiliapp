import { Chip, ProgressBar } from "@/components/ui";

export interface ModuleHeaderProps {
  position: number;
  title: string;
  completed: number;
  total: number;
}

export function ModuleHeader({ position, title, completed, total }: ModuleHeaderProps) {
  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] bg-ink p-4 text-white">
      <span className="self-start">
        <Chip tone="brand">{position}-MODUL</Chip>
      </span>
      <h2 className="text-xl font-extrabold">{title}</h2>
      <ProgressBar
        value={completed}
        max={Math.max(total, 1)}
        color="brand"
        label={`${title}: ${completed}/${total} dars`}
      />
      <p className="text-sm font-bold text-white/80">
        {completed}/{total} dars tugallandi
      </p>
    </div>
  );
}
