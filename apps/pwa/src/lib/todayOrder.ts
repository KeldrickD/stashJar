export const todayCardPriority: Record<string, number> = {
  weather_wednesday: 10,
  temperature_daily: 20,
  dice_daily: 30,
  envelopes_100: 35,
};

export function sortTodayCards<T extends { type: string; scheduledFor?: string }>(cards: T[]): T[] {
  return [...cards].sort((a, b) => {
    const pa = todayCardPriority[a.type] ?? 999;
    const pb = todayCardPriority[b.type] ?? 999;
    if (pa !== pb) return pa - pb;

    const ta = a.scheduledFor ? Date.parse(a.scheduledFor) : 0;
    const tb = b.scheduledFor ? Date.parse(b.scheduledFor) : 0;
    return ta - tb;
  });
}
