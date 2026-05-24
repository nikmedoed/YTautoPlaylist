// Background collection message handlers. Contains subscription collection, metadata lookup, start-date updates, and content collection routing.
import {
  getAutoCollectMeta,
  getPresentationState,
  setAutoCollectStartDate,
} from "../../store/index.js";
import { requestVideoIdsFromActiveTab } from "../collector.js";
import { handleVideoMetadata } from "../services.js";
import { collectAndAppendSubscriptions } from "../collectionSync.js";

export const collectionHandlers = {
  async "subscriptions:getMeta"() {
    const meta = await getAutoCollectMeta();
    return { meta };
  },

  async "playlist:collectSubscriptions"() {
    const meta = await getAutoCollectMeta();
    const nextRunAt = Number(meta?.nextAutoCollectAt) || 0;
    const now = Date.now();
    if (nextRunAt && nextRunAt > now) {
      const presentation = await getPresentationState();
      return {
        error: "ON_COOLDOWN",
        nextRunAt,
        remainingMs: nextRunAt - now,
        state: presentation,
      };
    }
    const result = await collectAndAppendSubscriptions({ origin: "manual" });
    if (result?.state) {
      return result;
    }
    const presentation = await getPresentationState();
    return { ...result, state: presentation };
  },

  async "collector:collect"(message) {
    return requestVideoIdsFromActiveTab(message.scope || "current");
  },

  async setStartDate(message) {
    if (message?.date) {
      try {
        const dt = new Date(message.date);
        if (!Number.isNaN(dt.getTime())) {
          const meta = await setAutoCollectStartDate(dt);
          return { ok: true, lastRunAt: meta.lastRunAt };
        }
      } catch {
        /* ignore invalid date */
      }
    }
    const meta = await getAutoCollectMeta();
    return { ok: true, lastRunAt: meta.lastRunAt };
  },

  async videoDate(message) {
    const info = await handleVideoMetadata(message);
    if (info.error) return info;
    if (info.publishedAt) {
      await setAutoCollectStartDate(info.publishedAt);
    }
    return { date: info.publishedAt || null };
  },

  async videoInfo(message) {
    const info = await handleVideoMetadata(message);
    if (info.error) return info;
    return { info };
  },
};
