import * as React from "react";

export function SuccessPulse({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  return <div className={active ? "sj-success-pulse" : ""}>{children}</div>;
}
