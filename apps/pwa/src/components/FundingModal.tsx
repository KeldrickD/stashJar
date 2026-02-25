"use client";

import dynamic from "next/dynamic";

const FundCardContent = dynamic(
  () => import("./FundCardContent").then((mod) => mod.FundCardContent),
  {
    ssr: false,
    loading: () => (
      <div className="py-6 text-center text-sm sj-text-muted">
        Loading funding form…
      </div>
    ),
  },
);

type Props = {
  open: boolean;
  sessionToken: string | null;
  onClose: () => void;
  onAfterFunding: () => void;
};

export function FundingModal({ open, sessionToken, onClose, onAfterFunding }: Props) {
  if (!open) return null;

  const handleClose = () => {
    onClose();
    onAfterFunding();
  };

  return (
    <div className="sj-scrim" role="dialog" aria-modal="true">
      <div className="relative w-full max-w-md sj-card-solid p-4">
        <button
          type="button"
          onClick={handleClose}
          className="absolute right-3 top-3 rounded p-1 sj-text-faint hover:bg-white/80 hover:text-[var(--sj-text)]"
          aria-label="Close"
        >
          ✕
        </button>
        {sessionToken ? (
          <FundCardContent sessionToken={sessionToken} />
        ) : (
          <div className="py-6 text-center text-sm sj-text-muted">
            Funding session not available. Use Refresh after adding funds elsewhere.
          </div>
        )}
        <p className="mt-3 text-center text-xs sj-text-faint">
          Tap <strong>Refresh</strong> if your balance doesn’t update in ~30s.
        </p>
        <button
          type="button"
          onClick={handleClose}
          className="mt-2 w-full sj-btn sj-btn-secondary py-2 text-sm font-medium"
        >
          Close
        </button>
      </div>
    </div>
  );
}
