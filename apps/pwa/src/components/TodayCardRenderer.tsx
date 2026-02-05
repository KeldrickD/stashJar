"use client";

import { WeatherWednesdayCard } from "@/components/WeatherWednesdayCard";
import { TemperatureCard } from "@/components/TemperatureCard";
import { DiceCard } from "@/components/DiceCard";
import { EnvelopesCard } from "@/components/EnvelopesCard";
import type { TodayCard } from "@/lib/api";

type Props = {
  userId: string;
  card: TodayCard;
  onDone: () => void;
};

export function TodayCardRenderer({ userId, card, onDone }: Props) {
  switch (card.type) {
    case "weather_wednesday":
      return <WeatherWednesdayCard userId={userId} card={card as any} onDone={onDone} />;
    case "temperature_daily":
      return <TemperatureCard userId={userId} card={card as any} onDone={onDone} />;
    case "dice_daily":
      return <DiceCard userId={userId} card={card as any} onDone={onDone} />;
    case "envelopes_100":
      return <EnvelopesCard userId={userId} card={card as any} onDone={onDone} />;
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
