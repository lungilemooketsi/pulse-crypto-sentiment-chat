// Generated datasets shipped with each deploy; see pipeline/pulse_pipeline/history.py and anomalies.py.
import type { History } from "./simulate";

export type EpisodeAsset = {
  asset: string;
  name: string;
  kind: string;
  peak_day: string;
  z: number;
  move: number | null;
  next_30_days: number | null;
};

export type Episode = {
  id: string;
  start: string;
  end: string;
  assets: EpisodeAsset[];
  category: string;
  summary: string | null;
  headlines: Array<{ title: string; url: string; source: string }>;
};

export type AnomalyData = {
  generated_at: string;
  method: { z_min: number; rare_share: number; window_days: number; categoriser: string };
  categories: Record<string, string>;
  known_events: { found: number; total: number; recall: number; missed: Array<{ asset: string; date: string; event: string }> };
  episodes: Episode[];
};

function loader<T>(path: string) {
  let request: Promise<T | null> | null = null;
  return () => {
    request ??= fetch(path, { headers: { Accept: "application/json" } })
      .then((response) => (response.ok ? (response.json() as Promise<T>) : null))
      .catch(() => null);
    return request;
  };
}

export const loadHistory = loader<History>("/data/history.json");
const loadRawAnomalies = loader<AnomalyData>("/data/anomalies.json");

/** The library's data, with missing optional fields filled, so one incomplete episode can't break the page. */
export const loadAnomalies = async () => {
  const data = await loadRawAnomalies();
  if (!data) return null;
  const episodes = data.episodes.map((episode) => ({
    ...episode,
    category: episode.category ?? "uncategorised",
    summary: episode.summary ?? null,
    headlines: episode.headlines ?? [],
  }));
  return { ...data, episodes };
};
