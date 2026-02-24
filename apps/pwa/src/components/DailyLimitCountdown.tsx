"use client";

import { useEffect, useState } from "react";

export type DailyLimitCountdownProps = {
  nextAllowedAt: string;
  label?: string;
};

export function DailyLimitCountdown({ nextAllowedAt, label }: DailyLimitCountdownProps) {
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, Math.floor((new Date(nextAllowedAt).getTime() - Date.now()) / 1000)),
  );

  useEffect(() => {
    const id = setInterval(() => {
      setSecondsLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [nextAllowedAt]);

  const hours = Math.floor(secondsLeft / 3600);
  const minutes = Math.floor((secondsLeft % 3600) / 60);

  return (
    <div className="text-sm text-amber-700">
      {label ?? "Daily limit reached"} — resets in {hours}h {minutes}m
    </div>
  );
}
