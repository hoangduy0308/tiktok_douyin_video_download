import { ERROR_CODES, makeError } from "../utils/errors.js";
import { sanitizeFilename, buildFilename, getExtensionFromUrl } from "../utils/filename.js";
import {
  upsertRecord,
  updateRecordById,
  updateRecordByDownloadId,
  updateRecordProgress
} from "../utils/storage.js";
import { createResult } from "../utils/messages.js";
import { armFallbackMatcher, initDownloadTracker } from "./download-tracker.js";
import { processDouyinClipboard } from "../utils/douyin-extractor.js";

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

async function handleClipboardDownload(message) {
  const { payload, requestId } = message;
  const clipboardText = payload.clipboardText;

  try {
    const videoInfo = await processDouyinClipboard(clipboardText);
    const filename = buildFilename({
      author: videoInfo.author || videoInfo.authorId,
      id: videoInfo.id,
      ext: getExtensionFromUrl(videoInfo.bestUrl)
    });

    const safeFilename = sanitizeFilename(filename);
    const now = Date.now();

    await upsertRecord({
      recordId: requestId,
      id: videoInfo.id,
      platform: "douyin",
      title: videoInfo.title,
      author: videoInfo.author,
      url: videoInfo.bestUrl,
      filename: safeFilename,
      time: now,
      status: "pending",
      method: "downloads_api"
    });

    const downloadId = await downloadsDownload({
      url: videoInfo.bestUrl,
      filename: safeFilename,
      saveAs: false
    });

    await updateRecordById(requestId, {
      downloadId,
      status: "in_progress",
      filename: safeFilename,
      method: "downloads_api"
    });

    return createResult("CLIPBOARD_DOWNLOAD_RESULT", requestId, true, {
      downloadId,
      video: videoInfo
    });
  } catch (err) {
    const messageText = err?.message || "DOWNLOAD_FAILED";
    let code = ERROR_CODES.PARSE_ERROR;
    
    if (messageText.includes("403")) {
      code = ERROR_CODES.DOWNLOAD_403;
    } else if (messageText.includes("FORMAT_UNSUPPORTED")) {
      code = ERROR_CODES.FORMAT_UNSUPPORTED;
    }

    await updateRecordById(requestId, {
      status: "interrupted",
      lastError: makeError(code, messageText)
    }).catch(() => {});

    return createResult(
      "CLIPBOARD_DOWNLOAD_RESULT",
      requestId,
      false,
      null,
      makeError(code, messageText)
    );
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

  if (message.type === "CLIPBOARD_DOWNLOAD") {
    handleClipboardDownload(message)
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse(
          createResult(
            "CLIPBOARD_DOWNLOAD_RESULT",
            message.requestId,
            false,
            null,
            makeError(ERROR_CODES.PARSE_ERROR, error?.message)
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
