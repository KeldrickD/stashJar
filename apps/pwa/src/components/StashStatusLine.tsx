import * as React from "react";

type StatusTone = "default" | "muted" | "warning" | "success";

type StashStatusLineProps = {
  icon?: React.ReactNode;
  text: React.ReactNode;
  tone?: StatusTone;
  right?: React.ReactNode;
  compact?: boolean;
};

export function StashStatusLine({
  icon,
  text,
  tone = "muted",
  right,
  compact = false,
}: StashStatusLineProps) {
  const toneClass =
    tone === "warning"
      ? "sj-status-warning"
      : tone === "success"
        ? "sj-status-success"
        : tone === "default"
          ? "sj-status-default"
          : "sj-status-muted";

  return (
    <div className={`sj-status ${compact ? "sj-status-compact" : ""} ${toneClass}`.trim()}>
      <div className="sj-status-left">
        {icon ? <span className="sj-status-icon">{icon}</span> : null}
        <span>{text}</span>
      </div>
      {right ? <div className="sj-status-right">{right}</div> : null}
    </div>
  );
}
