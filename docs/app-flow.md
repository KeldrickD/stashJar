# Application Flow – StashJar

## PWA Flow

1. Login →
2. Home loads (`context=pwa`) →
3. Rail = `FUND_CARD` →
4. Add money → FundCard →
5. Refresh bridge →
6. Save challenge →
7. Streak updated

## MiniApp Flow

1. Open in frame →
2. Home loads (`context=miniapp`) →
3. Rail = `OPEN_IN_WALLET` →
4. Add money → deeplink →
5. Return → visibilitychange → refresh →
6. If SETTLED → refetch home → clear banner

## Push Flow

1. Push received →
2. SW focuses tab →
3. NAVIGATE message →
4. Router replace →
5. Scroll to challenge
