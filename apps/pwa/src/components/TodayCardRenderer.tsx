"use client";

import { WeatherWednesdayCard } from "@/components/WeatherWednesdayCard";
import { TemperatureCard } from "@/components/TemperatureCard";
import { DiceCard } from "@/components/DiceCard";
import { EnvelopesCard } from "@/components/EnvelopesCard";
import { StashCard } from "@/components/StashCard";
import { StashCardHeader } from "@/components/StashCardHeader";
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
    case "temperature_daily": {
      const temp = card as Extract<TodayCard, { type: "temperature_daily" }>;
      const normalizedScale: 1 | 10 | undefined =
        temp.scale === 1 || temp.scale === 10 ? temp.scale : undefined;
      const normalized = {
        ...temp,
        scale: normalizedScale,
        availableScales: (temp.availableScales ?? []).filter((s): s is 1 | 10 => s === 1 || s === 10),
      };
      return <TemperatureCard userId={userId} card={normalized} onDone={onDone} />;
    }
    case "dice_daily":
      return <DiceCard userId={userId} card={card as Extract<TodayCard, { type: "dice_daily" }>} actions={actions} onDone={onDone} />;
    case "envelopes_100":
      return <EnvelopesCard userId={userId} card={card as Extract<TodayCard, { type: "envelopes_100" }>} actions={actions} onDone={onDone} />;
    default:
      return (
        <StashCard variant="soft">
          <StashCardHeader icon="✨" title="New challenge" subtitle={
            <>
            Unsupported card type: <code>{card.type}</code>
            </>
          } />
        </StashCard>
      );
  }
}
