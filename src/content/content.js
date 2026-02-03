(function () {
  if (window.__DOUYIN_CONTENT_SCRIPT_INJECTED__) return;
  window.__DOUYIN_CONTENT_SCRIPT_INJECTED__ = true;

  const SHORT_HOSTS = new Set(["vt.tiktok.com", "vm.tiktok.com", "v.douyin.com"]);

  function isShortUrl(hostname) {
    return SHORT_HOSTS.has(hostname);
  }

  function getPlatform(hostname) {
    if (hostname.includes("tiktok.com")) return "tiktok";
    if (hostname.includes("douyin.com")) return "douyin";
    return "unknown";
  }

  function buildResult(requestId, ok, payload, error) {
    const result = {
      version: 1,
      requestId,
      type: "GET_VIDEO_INFO_RESULT",
      ok: Boolean(ok)
    };
    if (ok) {
      result.payload = payload;
    } else if (error) {
      result.error = error;
    }
    return result;
  }

  function buildError(code, message) {
    return { code, message };
  }

  async function handleGetVideoInfo(message) {
    const pageUrl = window.location.href;
    const hostname = window.location.hostname || "";

    if (isShortUrl(hostname)) {
      return buildResult(
        message.requestId,
        false,
        null,
        buildError("SHORT_URL_REDIRECTING", "Dang chuyen huong, vui long doi")
      );
    }

    const platform = getPlatform(hostname);
    if (platform === "unknown") {
      return buildResult(
        message.requestId,
        false,
        null,
        buildError("NOT_VIDEO_PAGE", "Khong phat hien video")
      );
    }

    let extracted = null;
    if (platform === "tiktok" && window.__TTDD_extractTikTok) {
      extracted = window.__TTDD_extractTikTok(document, pageUrl);
    } else if (platform === "douyin" && window.__TTDD_extractDouyin) {
      extracted = window.__TTDD_extractDouyin(document, pageUrl);
    }

    if (!extracted) {
      return buildResult(
        message.requestId,
        false,
        null,
        buildError("PARSE_ERROR", "Khong doc duoc du lieu")
      );
    }

    if (extracted.error) {
      return buildResult(message.requestId, false, null, extracted.error);
    }

    const payload = {
      platform: extracted.platform,
      pageUrl: extracted.pageUrl,
      video: extracted.video,
      source: extracted.source
    };

    return buildResult(message.requestId, true, payload, null);
  }

  async function handleFallback(message) {
    const { url, filename } = message.payload || {};
    if (!url) return;
    try {
      const a = document.createElement("a");
      a.href = url;
      if (filename) a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      // Ignore
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.version !== 1) return;

    if (message.type === "GET_VIDEO_INFO") {
      handleGetVideoInfo(message)
        .then((result) => sendResponse(result))
        .catch((error) =>
          sendResponse(
            buildResult(
              message.requestId,
              false,
              null,
              buildError("PARSE_ERROR", error?.message || "Khong doc duoc du lieu")
            )
          )
        );
      return true;
    }

    if (message.type === "DOWNLOAD_FALLBACK") {
      handleFallback(message);
    }
  });
})();
