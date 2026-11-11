import { notFound } from "next/navigation";
import { Lock } from "lucide-react";
import { ActiveTest } from "@/components/tests/ActiveTest";
import { StartButton, TestIntro } from "@/components/tests/TestIntro";
import { TestResult } from "@/components/tests/TestResult";
import { Button, EmptyState } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireStudent } from "@/server/guards";
import { loadTestView } from "@/server/tests";
import { createSupabaseTestStore } from "@/server/tests-store";
import { finishTestAction, saveTestAnswerAction, startTestAction } from "./actions";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TestPage({ params }: { params: Promise<{ testId: string }> }) {
  const { testId } = await params;
  const { user, role } = await requireStudent();
  if (role !== "student" || !UUID.test(testId)) notFound();

  const store = createSupabaseTestStore(await createClient(), createServiceClient());
  const view = await loadTestView(store, user.id, testId);
  if (!view) notFound();

  switch (view.kind) {
    case "locked":
      return (
        <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 p-4">
          <EmptyState
            icon={<Lock className="size-10" />}
            title={view.title}
            text="Testni ochish uchun avval modulning barcha darslarini tugating."
            action={
              <Button href="/path" variant="secondary">
                O&apos;quv yo&apos;liga qaytish
              </Button>
            }
          />
        </main>
      );
    case "intro":
      return (
        <TestIntro
          testId={view.test.id}
          title={view.test.title}
          itemCount={view.itemCount}
          timeLimitMin={view.test.timeLimitMin}
          passScore={view.test.passScore}
          maxAttempts={view.test.maxAttempts}
          start={startTestAction}
        />
      );
    case "active":
      return (
        <ActiveTest
          attemptId={view.attemptId}
          title={view.test.title}
          items={view.items}
          initialAnswers={view.answers}
          remainingMs={view.remainingMs}
          save={saveTestAnswerAction}
          finish={finishTestAction}
        />
      );
    default:
      return (
        <TestResult
          title={view.test.title}
          result={view.result}
          retake={<StartButton testId={view.test.id} start={startTestAction} label="Qayta topshirish" variant="secondary" />}
        />
      );
  }
}
