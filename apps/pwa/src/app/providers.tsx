"use client";

import type { ReactNode } from "react";
import { SwNavigateListener } from "@/components/SwNavigateListener";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <>
      <SwNavigateListener />
      {children}
    </>
  );
}
