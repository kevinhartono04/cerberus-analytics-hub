"use client";
import { useEffect, useState } from "react";
import { defaultGameNames } from "@/lib/game-catalog";
export function useGameOptions() {
  const [names, setNames] = useState<readonly string[]>(defaultGameNames);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/games", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json() as { games: Array<{ name: string }> };
        if (!cancelled) setNames(data.games.map(game => game.name));
      } catch { /* Existing dashboards surface account and query errors. */ }
    };
    void load();
    window.addEventListener("focus", load);
    return () => { cancelled = true; window.removeEventListener("focus", load); };
  }, []);
  return names;
}
