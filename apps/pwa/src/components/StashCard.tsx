import * as React from "react";

type StashCardVariant = "glass" | "soft";

export function StashCard({
  variant = "soft",
  className = "",
  children,
}: {
  variant?: StashCardVariant;
  className?: string;
  children: React.ReactNode;
}) {
  const base = variant === "glass" ? "sj-card" : "sj-card-soft";
  return (
    <section className={`${base} ${className}`.trim()}>
      <div className="sj-card-inner p-6">{children}</div>
    </section>
  );
}
