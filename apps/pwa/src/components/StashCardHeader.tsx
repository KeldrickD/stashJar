import * as React from "react";

export function StashCardHeader({
  icon,
  title,
  subtitle,
  badge,
  right,
  className = "",
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badge?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={`flex items-start justify-between gap-3 ${className}`.trim()}>
      <div className="flex items-start gap-3">
        <div className="sj-icon-bubble shrink-0">{icon}</div>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-lg font-semibold leading-tight truncate">
              {title}
            </div>
            {badge ? <div className="shrink-0">{badge}</div> : null}
          </div>

          {subtitle ? (
            <div className="mt-0.5 sj-text-muted text-sm leading-snug">
              {subtitle}
            </div>
          ) : null}
        </div>
      </div>

      {right ? <div className="shrink-0">{right}</div> : null}
    </header>
  );
}
