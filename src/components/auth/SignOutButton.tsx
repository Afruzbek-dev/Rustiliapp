"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/browser";

export function SignOutButton({ navigate = (to: string) => window.location.assign(to) }: { navigate?: (to: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    try {
      await createClient().auth.signOut();
    } finally {
      navigate("/login");
    }
  }
  return (
    <Button fullWidth variant="secondary" loading={busy} onClick={signOut}>
      <LogOut aria-hidden="true" className="size-5" />
      Chiqish
    </Button>
  );
}
