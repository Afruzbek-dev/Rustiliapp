import { BookOpen } from "lucide-react";
import { EmptyState } from "@/components/ui";
import { ModuleHeader } from "@/components/student/ModuleHeader";
import { PathNode } from "@/components/student/PathNode";
import { requireStudent } from "@/server/guards";
import { getPath } from "@/server/path";

export const dynamic = "force-dynamic";

const ZIGZAG_OFFSETS = [-70, 40, 70, -20, -80, 10] as const;

export default async function PathPage() {
  const { user } = await requireStudent();
  const path = await getPath(user.id);

  if (path.modules.length === 0) {
    return (
      <main className="bg-grid min-h-dvh p-4">
        <EmptyState
          icon={<BookOpen className="size-10" />}
          title="Kurs hali tayyor emas"
          text="Tez orada darslar paydo bo'ladi."
        />
      </main>
    );
  }

  let n = 0;
  return (
    <main className="bg-grid flex min-h-dvh flex-col gap-6 overflow-x-hidden p-4">
      <h1 className="sr-only">O&apos;quv yo&apos;li</h1>
      {path.modules.map((m) => (
        <section key={m.id} aria-label={`${m.position}-modul: ${m.title}`} className="flex flex-col gap-6">
          <ModuleHeader
            position={m.position}
            title={m.title}
            completed={m.completedLessons}
            total={m.lessons.length}
          />
          <div className="flex flex-col items-center gap-6">
            {m.lessons.map((l) => {
              const offset = ZIGZAG_OFFSETS[n++ % ZIGZAG_OFFSETS.length];
              const cont = l.parts.find((p) => p.id === l.continuePartId);
              return (
                <PathNode
                  key={l.id}
                  title={`Урок ${l.position}`}
                  subtitle={l.comingSoon ? "Tez orada" : l.title}
                  status={l.status}
                  href={l.continuePartId ? `/lesson/${l.continuePartId}` : undefined}
                  offset={offset}
                  currentDay={cont?.position}
                  lockedMessage={l.comingSoon ? "Tez orada" : undefined}
                  days={[
                    { label: "Grammatika", status: l.parts.find((p) => p.kind === "grammar")?.status ?? "locked" },
                    {
                      label: "Razgovor",
                      status: l.parts.find((p) => p.kind === "conversation")?.status ?? "locked",
                    },
                  ]}
                />
              );
            })}
            {m.test && (
              <PathNode
                kind="test"
                title="Test"
                subtitle={m.test.title}
                status={m.test.status === "available" ? "available" : "locked"}
                href={m.test.status === "available" ? `/test/${m.test.id}` : undefined}
                offset={ZIGZAG_OFFSETS[n++ % ZIGZAG_OFFSETS.length]}
                lockedMessage="Avval modul darslarini tugating"
              />
            )}
          </div>
        </section>
      ))}
    </main>
  );
}
