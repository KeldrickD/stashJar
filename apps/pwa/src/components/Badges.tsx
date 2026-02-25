import * as React from "react";

export function Badge({ children }: { children: React.ReactNode }) {
  return <span className="sj-badge">{children}</span>;
}

export function BaseChip() {
  return (
    <span className="sj-chip-base">
      <span className="sj-chip-base-dot" />
      USDC on Base
    </span>
  );
}

export function TodayBadge() {
  return <Badge>Today</Badge>;
}

export function PowerBadge() {
  return <Badge>POWER</Badge>;
}
