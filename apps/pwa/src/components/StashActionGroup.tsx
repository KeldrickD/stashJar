import * as React from "react";

type ActionConfig = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  iconLeft?: React.ReactNode;
};

type Tone = "default" | "warning" | "success";

export function StashActionGroup({
  primary,
  secondary,
  helperText,
  variant = "split",
  tone = "default",
  loading = false,
}: {
  primary: ActionConfig;
  secondary?: ActionConfig;
  helperText?: React.ReactNode;
  variant?: "stack" | "split";
  tone?: Tone;
  loading?: boolean;
}) {
  const helperClass =
    tone === "warning"
      ? "sj-helper-warning"
      : tone === "success"
        ? "sj-helper-success"
        : "sj-helper";

  const primaryLabel = loading ? `${primary.label}...` : primary.label;
  const secondaryLabel = secondary ? (loading ? `${secondary.label}...` : secondary.label) : undefined;
  const primaryDisabled = loading || primary.disabled;
  const secondaryDisabled = loading || secondary?.disabled;

  return (
    <div className="mt-4">
      {variant === "split" ? (
        <div className="sj-action-row grid grid-cols-2 gap-3">
          <button
            type="button"
            className="sj-btn sj-btn-primary py-3"
            onClick={primary.onClick}
            disabled={primaryDisabled}
          >
            {primary.iconLeft ? <span className="mr-1">{primary.iconLeft}</span> : null}
            {primaryLabel}
          </button>
          {secondary ? (
            <button
              type="button"
              className="sj-btn sj-btn-secondary py-3"
              onClick={secondary.onClick}
              disabled={secondaryDisabled}
            >
              {secondary.iconLeft ? <span className="mr-1">{secondary.iconLeft}</span> : null}
              {secondaryLabel}
            </button>
          ) : (
            <span />
          )}
        </div>
      ) : (
        <div className="sj-action-row flex flex-col gap-2">
          <button
            type="button"
            className="sj-btn sj-btn-primary w-full py-3"
            onClick={primary.onClick}
            disabled={primaryDisabled}
          >
            {primary.iconLeft ? <span className="mr-1">{primary.iconLeft}</span> : null}
            {primaryLabel}
          </button>
          {secondary ? (
            <button
              type="button"
              className="sj-btn sj-btn-secondary w-full py-3"
              onClick={secondary.onClick}
              disabled={secondaryDisabled}
            >
              {secondary.iconLeft ? <span className="mr-1">{secondary.iconLeft}</span> : null}
              {secondaryLabel}
            </button>
          ) : null}
        </div>
      )}
      {helperText ? <div className={helperClass}>{helperText}</div> : null}
    </div>
  );
}
