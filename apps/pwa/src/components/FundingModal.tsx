"use client";

import { FundCard } from "@coinbase/onchainkit/fund";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="relative w-full max-w-md rounded-xl bg-white p-4 shadow-xl dark:bg-zinc-900">
        <button
          type="button"
          onClick={handleClose}
          className="absolute right-3 top-3 rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          aria-label="Close"
        >
          ✕
        </button>
        {sessionToken ? (
          <FundCard
            sessionToken={sessionToken}
            assetSymbol="USDC"
            country="US"
            currency="USD"
            headerText="Add money"
            buttonText="Add money"
          />
        ) : (
          <div className="py-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
            Funding session not available. Use Refresh after adding funds elsewhere.
          </div>
        )}
        <p className="mt-3 text-center text-xs text-zinc-500">
          Tap <strong>Refresh</strong> if your balance doesn’t update in ~30s.
        </p>
        <button
          type="button"
          onClick={handleClose}
          className="mt-2 w-full rounded border border-zinc-300 py-2 text-sm font-medium dark:border-zinc-600"
        >
          Close
        </button>
      </div>
    </div>
  );
}
