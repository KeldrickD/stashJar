"use client";

import { WeatherWednesdayCard } from "@/components/WeatherWednesdayCard";
import { TemperatureCard } from "@/components/TemperatureCard";
import { DiceCard } from "@/components/DiceCard";
import { EnvelopesCard } from "@/components/EnvelopesCard";
import type { FeatureActions, TodayCard } from "@/lib/api";

type Props = {
  userId: string;
  card: TodayCard;
  actions: FeatureActions;
  onDone: () => void | Promise<void>;
};

export function TodayCardRenderer({ userId, card, actions, onDone }: Props) {
  switch (card.type) {
    case "weather_wednesday":
      return <WeatherWednesdayCard userId={userId} card={card as Extract<TodayCard, { type: "weather_wednesday" }>} onDone={onDone} />;
    case "temperature_daily":
      return <TemperatureCard userId={userId} card={card as Extract<TodayCard, { type: "temperature_daily" }>} onDone={onDone} />;
    case "dice_daily":
      return <DiceCard userId={userId} card={card as Extract<TodayCard, { type: "dice_daily" }>} actions={actions} onDone={onDone} />;
    case "envelopes_100":
      return <EnvelopesCard userId={userId} card={card as Extract<TodayCard, { type: "envelopes_100" }>} actions={actions} onDone={onDone} />;
    default:
      return (
        <section className="rounded-xl border p-5 space-y-2">
          <div className="text-lg font-semibold">New challenge</div>
          <div className="text-sm opacity-70">
            Unsupported card type: <code>{card.type}</code>
          </div>
        </section>
      );
  }
}
