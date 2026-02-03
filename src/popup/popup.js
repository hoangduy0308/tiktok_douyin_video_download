import { buildFilename, getExtensionFromUrl } from "../utils/filename.js";
import { createMessage } from "../utils/messages.js";
import { upsertRecord, loadDownloads, deleteRecord, clearDownloads } from "../utils/storage.js";
import { makeError } from "../utils/errors.js";

const stateEls = {
  loading: document.getElementById("state-loading"),
  empty: document.getElementById("state-empty"),
  error: document.getElementById("state-error"),
  success: document.getElementById("state-success")
};

const metaEl = document.getElementById("extracted-meta");
const errorMessageEl = document.getElementById("error-message");
const errorCodeEl = document.getElementById("error-code");
const videoThumbEl = document.getElementById("video-thumb");
const videoTitleEl = document.getElementById("video-title");
const videoAuthorEl = document.getElementById("video-author");
const videoMetaEl = document.getElementById("video-meta");
const downloadBtn = document.getElementById("btn-download");
const copyBtn = document.getElementById("btn-copy");
const progressEl = document.getElementById("download-progress");
const historyListEl = document.getElementById("history-list");
const toastEl = document.getElementById("toast");

let currentVideo = null;
let currentTabId = null;
let latestDownloads = [];

function setState(state) {
  Object.keys(stateEls).forEach((key) => {
    stateEls[key].classList.toggle("hidden", key !== state);
  });
}

function showToast(text) {
  toastEl.textContent = text;
  toastEl.classList.remove("hidden");
  setTimeout(() => toastEl.classList.add("hidden"), 2200);
}

function formatTimeAgo(time) {
  if (!time) return "";
  const diff = Math.max(0, Date.now() - time);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s truoc`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}p truoc`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h truoc`;
}

function updateMeta(source, platform) {
  if (!source) {
    metaEl.textContent = "Dang phat hien video...";
    return;
  }
  const timeText = formatTimeAgo(source.extractedAt);
  const platformText = platform === "tiktok" ? "TikTok" : "Douyin";
  metaEl.textContent = `Da trich xuat: ${timeText} ? ${platformText}`;
}

function renderVideo(video, platform, source, pageUrl) {
  currentVideo = { ...video, platform, pageUrl };
  videoThumbEl.src = video.thumbnailUrl || "";
  videoTitleEl.textContent = video.title || "(Khong co tieu de)";
  videoAuthorEl.textContent = video.author ? `@${video.author}` : "";
  const watermarkText = video.noWatermarkUrl ? "Khong watermark" : "Co the co watermark";
  videoMetaEl.textContent = `${video.format.toUpperCase()} ? ${watermarkText}`;
  updateMeta(source, platform);
  updateDownloadProgress();
}

function showError(error) {
  errorMessageEl.textContent = error?.message || "Co loi xay ra";
  errorCodeEl.textContent = error?.code || "UNKNOWN";
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendMessageWithRetry(tabId, message, retries = 3, delayMs = 300) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (error) {
      lastError = error;
      const messageText = error?.message || "";
      const isMissing = messageText.includes("Receiving end does not exist");
      if (!isMissing || attempt === retries) break;
      await wait(delayMs);
    }
  }
  throw lastError;
}

async function injectContentScripts(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.__DOUYIN_CONTENT_SCRIPT_INJECTED__
    });
    if (results?.[0]?.result) {
      return true;
    }

    const files = [
      "src/content/extractors/tiktok.js",
      "src/content/extractors/douyin.js",
      "src/content/content.js"
    ];

    for (const file of files) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: [file]
        });
      } catch (fileErr) {
        console.warn(`Failed to inject ${file}:`, fileErr?.message);
      }
    }

    return true;
  } catch {
    return false;
  }
}

async function requestVideoInfo() {
  setState("loading");
  const tab = await getActiveTab();
  if (!tab || !tab.id) {
    setState("empty");
    return;
  }
  currentTabId = tab.id;

  const message = createMessage("GET_VIDEO_INFO", { preferNoWatermark: true }, crypto.randomUUID());
  try {
    let response = await sendMessageWithRetry(tab.id, message, 2, 300);
    
    if (!response) {
      const injected = await injectContentScripts(tab.id);
      if (injected) {
        await wait(500);
        response = await sendMessageWithRetry(tab.id, message, 2, 300);
      }
    }
    
    if (response?.ok) {
      renderVideo(
        response.payload.video,
        response.payload.platform,
        response.payload.source,
        response.payload.pageUrl
      );
      setState("success");
    } else {
      const code = response?.error?.code;
      if (code === "NOT_VIDEO_PAGE") {
        setState("empty");
      } else {
        showError(response?.error || makeError("PARSE_ERROR"));
        setState("error");
      }
    }
  } catch (error) {
    const text = error?.message || "";
    if (text.includes("Receiving end does not exist")) {
      const injected = await injectContentScripts(tab.id);
      if (injected) {
        await wait(500);
        try {
          const response = await sendMessageWithRetry(tab.id, message, 2, 300);
          if (response?.ok) {
            renderVideo(
              response.payload.video,
              response.payload.platform,
              response.payload.source,
              response.payload.pageUrl
            );
            setState("success");
            return;
          } else {
            const code = response?.error?.code;
            if (code === "NOT_VIDEO_PAGE") {
              setState("empty");
              return;
            }
            showError(response?.error || makeError("PARSE_ERROR"));
            setState("error");
            return;
          }
        } catch {
          showError(makeError("CONTENT_SCRIPT_MISSING", "Khong the ket noi. Hay tai lai trang."));
          setState("error");
          return;
        }
      }
      showError(makeError("CONTENT_SCRIPT_MISSING"));
    } else {
      showError(makeError("PARSE_ERROR", text));
    }
    setState("error");
  }
}

function getPreferredUrl(video) {
  return video.noWatermarkUrl || video.bestUrl;
}

async function startDownload(fromRecord) {
  if (!currentVideo && !fromRecord) return;
  const video = fromRecord
    ? {
        id: fromRecord.id,
        platform: fromRecord.platform,
        title: fromRecord.title,
        author: fromRecord.author,
        url: fromRecord.url,
        thumbnailUrl: fromRecord.thumbnailUrl || "",
        bestUrl: fromRecord.url,
        noWatermarkUrl: fromRecord.url,
        format: getExtensionFromUrl(fromRecord.url)
      }
    : currentVideo;

  if (video.format === "m3u8") {
    showError(makeError("FORMAT_UNSUPPORTED"));
    setState("error");
    return;
  }

  const requestId = fromRecord?.recordId || crypto.randomUUID();
  const url = getPreferredUrl(video);
  const filename = buildFilename({
    author: video.author,
    id: video.id,
    ext: getExtensionFromUrl(url)
  });

  await upsertRecord({
    recordId: requestId,
    id: video.id,
    platform: video.platform,
    title: video.title,
    author: video.author,
    url,
    filename,
    time: Date.now(),
    status: "pending",
    method: "downloads_api",
    thumbnailUrl: video.thumbnailUrl || ""
  });

  downloadBtn.disabled = true;
  downloadBtn.textContent = "Dang tai...";
  setTimeout(() => {
    downloadBtn.disabled = false;
    downloadBtn.textContent = "Tai video";
  }, 1000);

  const response = await chrome.runtime.sendMessage(
    createMessage("DOWNLOAD_VIDEO", {
      platform: video.platform,
      pageUrl: currentVideo?.pageUrl || "",
      videoId: video.id,
      url,
      filename,
      tabId: currentTabId,
      title: video.title,
      author: video.author
    }, requestId)
  );

  if (response?.ok) {
    showToast("Dang tai video...");
  } else if (response?.error?.code === "DOWNLOAD_403") {
    showToast("Dang thu che do tuong thich...");
  } else if (response?.error) {
    showToast("Tai that bai");
  }
}

function updateDownloadProgress() {
  if (!currentVideo) return;
  const record = latestDownloads.find(
    (item) => item.id === currentVideo.id && item.platform === currentVideo.platform
  );
  if (!record) {
    progressEl.classList.add("hidden");
    return;
  }
  if (record.status === "in_progress") {
    const percent = record.progress && typeof record.progress.percent === "number" ? record.progress.percent : null;
    progressEl.textContent = percent === null ? "Dang tai..." : `Dang tai... ${percent}%`;
    progressEl.classList.remove("hidden");
  } else if (record.status === "complete") {
    progressEl.textContent = "Tai xong";
    progressEl.classList.remove("hidden");
  } else if (record.status === "interrupted") {
    progressEl.textContent = "Tai bi gian doan";
    progressEl.classList.remove("hidden");
  } else {
    progressEl.classList.add("hidden");
  }
}

function statusLabel(record) {
  if (record.method === "fallback_anchor") return "Fallback";
  switch (record.status) {
    case "complete":
      return "Hoan tat";
    case "in_progress":
      return "Dang tai";
    case "interrupted":
      return "Bi gian doan";
    default:
      return "Dang cho";
  }
}

function statusClass(record) {
  if (record.status === "complete") return "success";
  if (record.status === "interrupted") return "error";
  return "";
}

function renderHistory(list) {
  historyListEl.innerHTML = "";
  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "empty-text";
    empty.textContent = "Chua co lich su tai.";
    historyListEl.appendChild(empty);
    return;
  }

  list.forEach((record) => {
    const item = document.createElement("div");
    item.className = "history-item";

    const thumb = document.createElement("img");
    thumb.className = "history-thumb";
    thumb.src = record.thumbnailUrl || "";

    const info = document.createElement("div");
    info.className = "history-info";

    const title = document.createElement("div");
    title.className = "history-title";
    title.textContent = record.title || record.id || "(Khong tieu de)";

    const time = document.createElement("div");
    time.className = "history-time";
    time.textContent = formatTimeAgo(record.time);

    info.appendChild(title);
    info.appendChild(time);

    const status = document.createElement("div");
    status.className = `history-status ${statusClass(record)}`;
    status.textContent = statusLabel(record);

    const actions = document.createElement("div");
    actions.className = "history-actions";

    const btnOpen = document.createElement("button");
    btnOpen.className = "action-btn";
    btnOpen.textContent = "Mo file";
    btnOpen.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (record.downloadId) {
        chrome.downloads.open(record.downloadId);
      }
    });

    const btnFolder = document.createElement("button");
    btnFolder.className = "action-btn";
    btnFolder.textContent = "Mo thu muc";
    btnFolder.addEventListener("click", (event) => {
      event.stopPropagation();
      if (record.downloadId) {
        chrome.downloads.show(record.downloadId);
      }
    });

    const btnRetry = document.createElement("button");
    btnRetry.className = "action-btn";
    btnRetry.textContent = "Tai lai";
    btnRetry.addEventListener("click", (event) => {
      event.stopPropagation();
      startDownload(record);
    });

    const btnDelete = document.createElement("button");
    btnDelete.className = "action-btn";
    btnDelete.textContent = "Xoa";

    let confirmDelete = false;
    btnDelete.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (!confirmDelete) {
        confirmDelete = true;
        btnDelete.textContent = "Xac nhan?";
        setTimeout(() => {
          confirmDelete = false;
          btnDelete.textContent = "Xoa";
        }, 2000);
        return;
      }
      await deleteRecord(record.recordId);
      showToast("Da xoa khoi lich su");
    });

    actions.appendChild(btnOpen);
    actions.appendChild(btnFolder);
    actions.appendChild(btnRetry);
    actions.appendChild(btnDelete);

    item.appendChild(thumb);
    item.appendChild(info);
    item.appendChild(status);
    item.appendChild(actions);

    item.addEventListener("click", () => {
      item.classList.toggle("expanded");
    });

    historyListEl.appendChild(item);
  });
}

async function initHistory() {
  const list = await loadDownloads();
  latestDownloads = list;
  renderHistory(list);
  updateDownloadProgress();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.downloads) {
    latestDownloads = changes.downloads.newValue || [];
    renderHistory(latestDownloads);
    updateDownloadProgress();
  }
});

// Event bindings

document.getElementById("btn-refresh").addEventListener("click", requestVideoInfo);
document.getElementById("btn-retry").addEventListener("click", requestVideoInfo);
document.getElementById("btn-download").addEventListener("click", () => startDownload());

document.getElementById("btn-copy").addEventListener("click", async () => {
  if (!currentVideo) return;
  try {
    await navigator.clipboard.writeText(getPreferredUrl(currentVideo));
    showToast("Da sao chep link");
  } catch {
    showToast("Khong the sao chep");
  }
});

document.getElementById("btn-clear").addEventListener("click", async () => {
  await clearDownloads();
  showToast("Da xoa lich su");
});

document.getElementById("btn-clear-history").addEventListener("click", async () => {
  await clearDownloads();
  showToast("Da xoa lich su");
});

document.getElementById("btn-clipboard-download").addEventListener("click", async () => {
  const inputEl = document.getElementById("clipboard-input");
  const clipboardText = inputEl.value.trim();
  if (!clipboardText) {
    showToast("Vui long dan link Douyin");
    return;
  }

  const btn = document.getElementById("btn-clipboard-download");
  btn.disabled = true;
  btn.textContent = "Dang tai...";

  try {
    const response = await chrome.runtime.sendMessage(
      createMessage("CLIPBOARD_DOWNLOAD", { clipboardText }, crypto.randomUUID())
    );

    if (response?.ok) {
      showToast("Dang tai video...");
      inputEl.value = "";
    } else {
      const errMsg = response?.error?.message || "Khong the tai video";
      showToast(errMsg);
    }
  } catch (err) {
    showToast(err?.message || "Co loi xay ra");
  } finally {
    btn.disabled = false;
    btn.textContent = "Tai tu link";
  }
});

(async () => {
  await initHistory();
  await requestVideoInfo();
})();
