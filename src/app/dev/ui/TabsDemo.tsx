"use client";

import { useState } from "react";
import { Tabs } from "@/components/ui";

export function TabsDemo() {
  const [value, setValue] = useState("a");
  return (
    <Tabs
      label="Namuna"
      value={value}
      onChange={setValue}
      tabs={[
        { id: "a", label: "Birinchi" },
        { id: "b", label: "Ikkinchi" },
        { id: "c", label: "Uchinchi" },
      ]}
    />
  );
}
