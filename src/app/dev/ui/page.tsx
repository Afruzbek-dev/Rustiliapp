import { notFound } from "next/navigation";
import { Inbox, Plus } from "lucide-react";
import {
  Avatar,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  IconButton,
  ProgressBar,
  Sheet,
  Skeleton,
} from "@/components/ui";
import { TabsDemo } from "./TabsDemo";

export default function UiShowcasePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-4 pb-48">
      <h1 className="text-2xl font-extrabold">UI komponentlar</h1>

      <Card>
        <div className="flex flex-wrap gap-3">
          <Button>Asosiy</Button>
          <Button variant="secondary">Ikkinchi</Button>
          <Button variant="success">To&apos;g&apos;ri</Button>
          <Button variant="danger">Xato</Button>
          <Button variant="dark">Qora</Button>
          <Button size="lg">Katta</Button>
          <Button loading>Yuklanmoqda</Button>
          <Button href="/">Havola</Button>
          <IconButton aria-label="Qo'shish" icon={<Plus className="size-5" />} />
        </div>
      </Card>

      <Card tone="muted">
        <div className="flex flex-wrap gap-2">
          <Chip>Neytral</Chip>
          <Chip tone="brand">Sariq</Chip>
          <Chip tone="ok">To&apos;g&apos;ri</Chip>
          <Chip tone="fire">Olov</Chip>
          <Chip tone="info">Ma&apos;lumot</Chip>
          <Avatar name="Ali Valiyev" />
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-3">
          <ProgressBar value={40} label="Brend" />
          <ProgressBar value={70} color="ok" label="To'g'ri" />
          <ProgressBar value={20} color="info" label="Ma'lumot" />
          <ProgressBar value={90} color="fire" label="Olov" />
        </div>
      </Card>

      <Card>
        <TabsDemo />
      </Card>

      <Card>
        <div className="flex flex-col gap-2">
          <Skeleton height="h-6" width="w-1/2" />
          <Skeleton />
        </div>
      </Card>

      <Card>
        <EmptyState
          icon={<Inbox className="size-10" />}
          title="Hozircha bo'sh"
          text="Bu yerda hech narsa yo'q."
          action={<Button variant="secondary">Yangilash</Button>}
        />
        <ErrorState action={<Button variant="secondary">Qayta urinish</Button>} />
      </Card>

      <Sheet variant="ok" title="To'g'ri!">
        Barakalla.
      </Sheet>
    </main>
  );
}
