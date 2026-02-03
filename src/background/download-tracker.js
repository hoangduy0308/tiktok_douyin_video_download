import { updateRecordDownloadId, updateRecordById } from "../utils/storage.js";

const pendingFallbacks = new Map();

function normalizeUrl(url) {
  try {
    return new URL(url).toString();
  } catch {
    return url || "";
  }
}

export function armFallbackMatcher(url, recordId) {
  if (!url || !recordId) return;
  const key = normalizeUrl(url);
  const existing = pendingFallbacks.get(key);
  if (existing?.timeout) {
    clearTimeout(existing.timeout);
  }
  const timeout = setTimeout(() => pendingFallbacks.delete(key), 5000);
  pendingFallbacks.set(key, { recordId, timeout });
  updateRecordById(recordId, { method: "fallback_anchor" });
}

export function initDownloadTracker() {
  if (initDownloadTracker._initialized) return;
  initDownloadTracker._initialized = true;

  chrome.downloads.onCreated.addListener(async (item) => {
    const candidates = [item.url, item.finalUrl].filter(Boolean).map(normalizeUrl);
    for (const candidate of candidates) {
      const pending = pendingFallbacks.get(candidate);
      if (pending) {
        clearTimeout(pending.timeout);
        pendingFallbacks.delete(candidate);
        await updateRecordDownloadId(pending.recordId, item.id);
        break;
      }
    }
  });
}
