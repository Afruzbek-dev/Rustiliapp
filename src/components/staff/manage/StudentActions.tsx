import type { ReactNode } from "react";
import { Card } from "@/components/ui";
import { TextField } from "../editor/fields";
import type { StaffAction } from "../action-state";
import { ActionForm, selectClass } from "./ActionForm";
import type { StudentDetail } from "@/server/manage-read";

export interface StudentActionHandlers {
  approve: StaffAction;
  reject: StaffAction;
  expire: StaffAction;
  move: StaffAction;
  setExpiry: StaffAction;
  linkTelegram: StaffAction;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Card>
      <section className="flex flex-col gap-3">
        <h3 className="text-base font-extrabold">{title}</h3>
        {hint && <p className="text-sm text-ink-2">{hint}</p>}
        {children}
      </section>
    </Card>
  );
}

function GroupSelect({ groups, value, label, emptyLabel }: { groups: { id: string; name: string }[]; value: string; label: string; emptyLabel: string }) {
  return (
    <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm font-bold text-ink-2">
      {label}
      <select name="groupId" defaultValue={value} className={selectClass}>
        <option value="">{emptyLabel}</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** `YYYY-MM-DD` of the day `days` from now, in UTC (only a default for the date picker). */
function inDays(days: number, now: Date): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * All the actions available for one enrollment, shown according to its status. Every form posts to
 * a server action; authority is re-checked there, so hiding a form is only a convenience.
 */
export function StudentActions({ detail, handlers, now = new Date() }: { detail: StudentDetail; handlers: StudentActionHandlers; now?: Date }) {
  const { status } = detail;
  const idField = <input type="hidden" name="enrollmentId" value={detail.enrollmentId} />;
  const canApprove = status === "pending" || status === "rejected" || status === "expired";
  const canMove = status !== "rejected";
  const hasGroups = detail.groups.length > 0;

  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))]">
      {canApprove && (
        <Section
          title={status === "pending" ? "Ruxsat so'rovi" : "Qayta ruxsat berish"}
          hint={hasGroups ? "Guruh tanlanmasa, eng kam o'quvchili guruh tanlanadi." : "Bu guruhda kurator guruhlari hali yo'q."}
        >
          <ActionForm action={handlers.approve} submitLabel={status === "pending" ? "Ruxsat berish" : "Qayta ruxsat berish"} variant="success">
            {idField}
            {hasGroups && <GroupSelect groups={detail.groups} value="" label="Kurator guruhi" emptyLabel="Avtomatik" />}
          </ActionForm>
          {status === "pending" && (
            <ActionForm action={handlers.reject} submitLabel="Rad etish">
              {idField}
            </ActionForm>
          )}
        </Section>
      )}

      {canMove && (
        <Section title="Kurator guruhi" hint={detail.groupName ? `Hozir: ${detail.groupName}` : "Hozir guruhsiz."}>
          <ActionForm action={handlers.move} submitLabel="Saqlash" inline>
            {idField}
            <GroupSelect groups={detail.groups} value={detail.groupId ?? ""} label="Guruh" emptyLabel="Guruhsiz" />
          </ActionForm>
        </Section>
      )}

      {(status === "active" || status === "expired") && (
        <Section title="Kirish muddati" hint={status === "expired" ? "Yangi sana berilsa, o'quvchi qayta faol bo'ladi." : undefined}>
          <ActionForm action={handlers.setExpiry} submitLabel="Muddatni yangilash" inline>
            {idField}
            <TextField label="Yangi sana" name="expiresOn" type="date" required min={inDays(1, now)} max={inDays(365 * 3 - 1, now)} defaultValue={inDays(30, now)} />
          </ActionForm>
          {status === "active" && (
            <ActionForm action={handlers.expire} submitLabel="Kursni hozir tugatish">
              {idField}
            </ActionForm>
          )}
        </Section>
      )}

      {detail.canLinkTelegram && (
        <Section
          title="Telegramni qo'lda ulash"
          hint="Bu profilda telefon bor, lekin Telegram ulanmagan. O'quvchi botga /start bosgan bo'lishi shart; ID raqamini @userinfobot orqali bilish mumkin."
        >
          <ActionForm action={handlers.linkTelegram} submitLabel="Ulash" inline>
            <input type="hidden" name="profileId" value={detail.studentId} />
            <TextField label="Telegram ID (raqam)" name="telegramId" inputMode="numeric" pattern="[0-9]{5,15}" required autoComplete="off" />
          </ActionForm>
        </Section>
      )}
    </div>
  );
}
