import Link from "next/link";
import { Search, UserCheck } from "lucide-react";
import { Button, Card, Chip, EmptyState } from "@/components/ui";
import { TextField, inputClass } from "../editor/fields";
import type { StaffAction } from "../action-state";
import { ActionForm, selectClass } from "./ActionForm";
import type { CuratorCandidate } from "@/server/manage";
import type { GroupRow, StatusCounts } from "@/server/manage-read";

export const QUEUE_ALERT = 15;

export interface CuratorHandlers {
  createGroup: StaffAction;
  updateGroup: StaffAction;
  assign: StaffAction;
  reassign: StaffAction;
}

export interface CuratorsPanelProps {
  cohortId: string;
  groups: GroupRow[];
  counts: StatusCounts;
  /** Result of the exact-match curator lookup (`?find=`), or null when nothing was searched. */
  candidates: CuratorCandidate[] | null;
  findQuery: string;
  /** Set when the lookup itself failed (message shown instead of results). */
  findError: string | null;
  handlers: CuratorHandlers;
}

function Balance({ groups, counts }: { groups: GroupRow[]; counts: StatusCounts }) {
  const max = Math.max(1, ...groups.map((g) => g.students));
  return (
    <Card>
      <section className="flex flex-col gap-3" aria-labelledby="balance">
        <h2 id="balance" className="text-lg font-extrabold">Yuklanish</h2>
        <p className="text-sm text-ink-2">
          Guruhsiz: <b className="text-ink">{counts.ungrouped}</b> · Ruxsat kutmoqda: <b className="text-ink">{counts.pending}</b>
        </p>
        {groups.length === 0 ? (
          <p className="text-ink-2">Kurator guruhlari hali yo&apos;q.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[460px] text-left text-sm">
              <caption className="sr-only">Kuratorlar yuklanishi</caption>
              <thead>
                <tr className="text-ink-2">
                  <th scope="col" className="py-2 pr-3 font-bold">Guruh</th>
                  <th scope="col" className="py-2 pr-3 font-bold">Kurator</th>
                  <th scope="col" className="py-2 pr-3 font-bold">O&apos;quvchilar</th>
                  <th scope="col" className="py-2 text-right font-bold">Navbat</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.id} className="border-t border-border text-ink">
                    <th scope="row" className="py-2 pr-3 font-bold">{g.name}</th>
                    <td className="py-2 pr-3">{g.curatorName ?? "Tayinlanmagan"}</td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2">
                        <progress className="h-2 w-24" max={max} value={g.students} aria-label={`${g.name}: ${g.students} ta o'quvchi`} />
                        <span>{g.students}</span>
                      </div>
                    </td>
                    <td className="py-2 text-right">
                      {g.pendingQueue > QUEUE_ALERT ? (
                        <Chip tone="fire">
                          {g.pendingQueue}
                          <span className="sr-only"> ta, navbat uzun</span>
                        </Chip>
                      ) : (
                        g.pendingQueue
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Card>
  );
}

function GroupCard({ cohortId, group, groups, candidates, handlers }: { cohortId: string; group: GroupRow; groups: GroupRow[]; candidates: CuratorCandidate[] | null; handlers: CuratorHandlers }) {
  const others = groups.filter((g) => g.id !== group.id);
  return (
    <Card>
      <article className="flex flex-col gap-3" aria-label={group.name}>
        <header className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-lg font-extrabold">{group.name}</h3>
            <p className="text-sm text-ink-2">
              {group.curatorName ? `Kurator: ${group.curatorName}` : "Kurator tayinlanmagan"}
              {group.curatorId && !group.curatorTelegramLinked && <span className="text-fire-text"> (Telegram ulanmagan)</span>}
            </p>
          </div>
          <Chip>{group.students} ta o&apos;quvchi</Chip>
        </header>

        <details className="rounded-[var(--radius-md)] border-2 border-border p-3">
          <summary className="flex min-h-11 cursor-pointer items-center font-bold">Nomi va Telegram chat</summary>
          <div className="mt-2">
            <ActionForm action={handlers.updateGroup} submitLabel="Saqlash" variant="primary">
              <input type="hidden" name="groupId" value={group.id} />
              <TextField label="Guruh nomi" name="name" required maxLength={80} defaultValue={group.name} />
              <TextField
                label="Tekshiruv chati ID (Telegram)"
                name="chatId"
                inputMode="numeric"
                pattern="-?[0-9]{1,15}"
                defaultValue={group.telegramChatId ?? ""}
                hint="Videolar shu chatga tushadi. Bo'sh qoldirilsa, chat ulanmaydi."
              />
            </ActionForm>
          </div>
        </details>

        <div className="flex flex-col gap-2">
          {group.curatorId && (
            <ActionForm action={handlers.assign} submitLabel="Kuratorni olib tashlash">
              <input type="hidden" name="groupId" value={group.id} />
              <input type="hidden" name="curatorId" value="" />
            </ActionForm>
          )}
          {candidates && candidates.length > 0 && (
            <ActionForm action={handlers.assign} submitLabel="Tayinlash" variant="primary" inline>
              <input type="hidden" name="groupId" value={group.id} />
              <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm font-bold text-ink-2">
                Topilgan profil
                <select name="curatorId" required className={selectClass}>
                  {candidates.map((c) => (
                    <option key={c.profileId} value={c.profileId} disabled={!c.telegramLinked}>
                      {c.name} {c.phone ?? ""} {c.telegramLinked ? "" : "(Telegram yo'q)"}
                    </option>
                  ))}
                </select>
              </label>
            </ActionForm>
          )}
        </div>

        {others.length > 0 && group.students > 0 && (
          <details className="rounded-[var(--radius-md)] border-2 border-border p-3">
            <summary className="flex min-h-11 cursor-pointer items-center font-bold">O&apos;quvchilarni ko&apos;chirish</summary>
            <div className="mt-2">
              <ActionForm action={handlers.reassign} submitLabel="Ko'chirish" inline>
                <input type="hidden" name="cohortId" value={cohortId} />
                <input type="hidden" name="fromGroupId" value={group.id} />
                <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm font-bold text-ink-2">
                  Qaysi guruhga
                  <select name="toGroupId" className={selectClass}>
                    <option value="">Guruhsiz</option>
                    {others.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>
                <TextField label="Nechta (1–100)" name="limit" type="number" min={1} max={100} defaultValue={100} required />
              </ActionForm>
            </div>
          </details>
        )}
      </article>
    </Card>
  );
}

/**
 * Curator groups of one cohort: balance view, create/rename (+ Telegram review chat), curator
 * assignment (exact lookup by phone / Telegram id / @username; the server grants the role) and
 * bulk reassignment (at most 100 students per call).
 */
export function CuratorsPanel({ cohortId, groups, counts, candidates, findQuery, findError, handlers }: CuratorsPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <Balance groups={groups} counts={counts} />

      <Card>
        <section className="flex flex-col gap-3" aria-labelledby="find-curator">
          <h2 id="find-curator" className="flex items-center gap-2 text-lg font-extrabold">
            <UserCheck aria-hidden="true" className="size-5" />
            Kurator qidirish
          </h2>
          <p className="text-sm text-ink-2">
            Telefon raqami (to&apos;liq), Telegram ID yoki @username bo&apos;yicha. Profilda tasdiqlangan Telegram bo&apos;lishi shart. Topilgach,
            guruhdagi &quot;Tayinlash&quot; tugmasi chiqadi.
          </p>
          <form method="get" action="/teacher/curators" role="search" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="cohort" value={cohortId} />
            <label className="flex min-w-52 flex-1 flex-col gap-1 text-sm font-bold text-ink-2">
              Telefon, Telegram ID yoki @username
              <input type="search" name="find" defaultValue={findQuery} maxLength={64} className={inputClass} />
            </label>
            <Button type="submit">
              <Search aria-hidden="true" className="size-5" />
              Qidirish
            </Button>
          </form>
          {findError && (
            <p role="alert" className="text-sm font-bold text-fire-text">
              {findError}
            </p>
          )}
          {candidates && !findError && (
            <p role="status" className="text-sm font-bold text-ink">
              {candidates.length === 0 ? "Hech narsa topilmadi" : `${candidates.length} ta profil topildi`}
            </p>
          )}
          {candidates && candidates.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {candidates.map((c) => (
                <li key={c.profileId} className="text-ink">
                  <b>{c.name}</b> · {c.phone ?? "telefon yo'q"} · {c.telegramLinked ? "Telegram ulangan" : "Telegram ulanmagan"}
                </li>
              ))}
            </ul>
          )}
        </section>
      </Card>

      <Card>
        <section className="flex flex-col gap-3" aria-labelledby="new-group">
          <h2 id="new-group" className="text-lg font-extrabold">Yangi kurator guruhi</h2>
          <ActionForm action={handlers.createGroup} submitLabel="Yaratish" variant="primary">
            <input type="hidden" name="cohortId" value={cohortId} />
            <TextField label="Guruh nomi" name="name" required maxLength={80} />
            <TextField label="Tekshiruv chati ID (ixtiyoriy)" name="chatId" inputMode="numeric" pattern="-?[0-9]{1,15}" />
          </ActionForm>
        </section>
      </Card>

      {groups.length === 0 ? (
        <EmptyState icon={<UserCheck className="size-10" />} title="Kurator guruhlari yo'q" text="Birinchi guruhni yuqoridagi shakldan yarating." />
      ) : (
        <ul className="flex flex-col gap-4">
          {groups.map((g) => (
            <li key={g.id}>
              <GroupCard cohortId={cohortId} group={g} groups={groups} candidates={candidates} handlers={handlers} />
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-ink-2">
        O&apos;quvchini bitta guruhdan boshqasiga ko&apos;chirish: <Link className="font-bold text-info-strong underline" href={`/teacher/students?cohort=${cohortId}`}>O&apos;quvchilar</Link> sahifasida.
      </p>
    </div>
  );
}
