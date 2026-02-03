import { ERROR_CODES, makeError } from "../utils/errors.js";
import { sanitizeFilename } from "../utils/filename.js";
import {
  upsertRecord,
  updateRecordById,
  updateRecordByDownloadId,
  updateRecordProgress
} from "../utils/storage.js";
import { createResult } from "../utils/messages.js";
import { armFallbackMatcher, initDownloadTracker } from "./download-tracker.js";

initDownloadTracker();

function downloadsDownload(options) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(options, (downloadId) => {
      const err = chrome.runtime.lastError;
      if (err || !downloadId) {
        reject(err || new Error("DOWNLOAD_FAILED"));
      } else {
        resolve(downloadId);
      }
    });
  });
}

async function sendFallbackToTab(tabId, url, filename) {
  if (!tabId) return;
  try {
    await chrome.tabs.sendMessage(tabId, {
      version: 1,
      requestId: crypto.randomUUID(),
      type: "DOWNLOAD_FALLBACK",
      payload: { url, filename }
    });
  } catch {
    // Ignore if tab no longer available.
  }
}

async function handleDownload(message) {
  const { payload, requestId } = message;
  const now = Date.now();
  const safeFilename = sanitizeFilename(payload.filename);

  await upsertRecord({
    recordId: requestId,
    id: payload.videoId,
    platform: payload.platform,
    title: payload.title,
    author: payload.author,
    url: payload.url,
    filename: safeFilename,
    time: now,
    status: "pending",
    method: "downloads_api"
  });

  try {
    const downloadId = await downloadsDownload({
      url: payload.url,
      filename: safeFilename,
      saveAs: false
    });

    await updateRecordById(requestId, {
      downloadId,
      status: "in_progress",
      filename: safeFilename,
      method: "downloads_api"
    });

    return createResult("DOWNLOAD_VIDEO_RESULT", requestId, true, { downloadId });
  } catch (err) {
    const messageText = err?.message || "DOWNLOAD_FAILED";
    const code = messageText.includes("403") ? ERROR_CODES.DOWNLOAD_403 : ERROR_CODES.INTERRUPTED;

    await updateRecordById(requestId, {
      status: "interrupted",
      lastError: makeError(code, messageText)
    });

    // Fallback: arm matcher and trigger download in page context.
    armFallbackMatcher(payload.url, requestId);
    await updateRecordById(requestId, { status: "in_progress", method: "fallback_anchor" });
    await sendFallbackToTab(payload.tabId, payload.url, safeFilename);

    return createResult("DOWNLOAD_VIDEO_RESULT", requestId, false, null, makeError(code, messageText));
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.version !== 1) return;
  if (message.type === "DOWNLOAD_VIDEO") {
    handleDownload(message)
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse(
          createResult(
            "DOWNLOAD_VIDEO_RESULT",
            message.requestId,
            false,
            null,
            makeError(ERROR_CODES.INTERRUPTED, error?.message)
          )
        )
      );
    return true;
  }
});

chrome.downloads.onChanged.addListener(async (delta) => {
  if (!delta || typeof delta.id !== "number") return;

  const patch = {};
  if (delta.state?.current) {
    if (delta.state.current === "complete") {
      patch.status = "complete";
    } else if (delta.state.current === "interrupted") {
      patch.status = "interrupted";
    } else if (delta.state.current === "in_progress") {
      patch.status = "in_progress";
    }
  }

  if (delta.filename?.current) {
    patch.filename = delta.filename.current;
  }

  if (delta.error?.current) {
    patch.lastError = makeError(ERROR_CODES.INTERRUPTED, delta.error.current);
  }

  if (Object.keys(patch).length > 0) {
    await updateRecordByDownloadId(delta.id, patch);
  }

  if (delta.bytesReceived) {
    const items = await chrome.downloads.search({ id: delta.id });
    const item = items && items[0];
    if (item && item.totalBytes > 0) {
      const percent = Math.round((item.bytesReceived / item.totalBytes) * 100);
      await updateRecordProgress(delta.id, {
        bytesReceived: item.bytesReceived,
        totalBytes: item.totalBytes,
        percent
      });
    }
  }
});
