(function () {
  function decodeRenderData(text) {
    let result = text || "";
    for (let i = 0; i < 3; i += 1) {
      if (!result.includes("%7B") && !result.includes("%5B")) break;
      result = decodeURIComponent(result.replace(/\+/g, "%20"));
    }
    return result;
  }

  function getVideoIdFromUrl(url) {
    try {
      const match = url.match(/\/video\/(\d+)/);
      return match ? match[1] : "";
    } catch {
      return "";
    }
  }

  function getFormat(url) {
    if (!url) return "unknown";
    const clean = url.split("?")[0].toLowerCase();
    if (clean.endsWith(".m3u8")) return "m3u8";
    if (clean.endsWith(".mp4")) return "mp4";
    return "unknown";
  }

  function findAweme(root) {
    const queue = [root];
    const seen = new Set();
    let steps = 0;
    while (queue.length > 0 && steps < 500) {
      const node = queue.shift();
      steps += 1;
      if (!node || typeof node !== "object") continue;
      if (seen.has(node)) continue;
      seen.add(node);

      const direct =
        node.aweme_detail ||
        node.awemeDetail ||
        node.aweme ||
        node.detail ||
        node.awemeInfo;

      if (direct && direct.video) {
        return direct;
      }

      if (node.video && (node.aweme_id || node.awemeId)) {
        return node;
      }

      for (const key of Object.keys(node)) {
        const value = node[key];
        if (value && typeof value === "object") {
          queue.push(value);
        }
      }
    }
    return null;
  }

  function extractDouyin(doc, pageUrl) {
    const videoId = getVideoIdFromUrl(pageUrl);
    if (!videoId) {
      return { error: { code: "NOT_VIDEO_PAGE", message: "Khong phat hien video" } };
    }

    const renderEl = doc.getElementById("RENDER_DATA");
    const nextEl = doc.getElementById("__NEXT_DATA__");
    let data = null;
    let sourceKind = null;

    if (renderEl) {
      try {
        const text = decodeRenderData(renderEl.textContent || "");
        data = JSON.parse(text);
        sourceKind = "RENDER_DATA";
      } catch {
        return { error: { code: "PARSE_ERROR", message: "Khong doc duoc du lieu" } };
      }
    }

    if (!data && nextEl) {
      try {
        data = JSON.parse(nextEl.textContent || "{}");
        sourceKind = "NEXT_DATA";
      } catch {
        return { error: { code: "PARSE_ERROR", message: "Khong doc duoc du lieu" } };
      }
    }

    if (!data) {
      return { error: { code: "PARSE_ERROR", message: "Khong doc duoc du lieu" } };
    }

    const root = Array.isArray(data) ? data : [data];
    let aweme = null;
    for (const entry of root) {
      aweme = findAweme(entry);
      if (aweme) break;
    }

    if (!aweme) {
      return { error: { code: "SCHEMA_CHANGED", message: "Khong tim thay video" } };
    }

    if (aweme.image_post_info || aweme.images) {
      return { error: { code: "PHOTO_POST", message: "Bai nay la anh/carousel" } };
    }

    if (aweme.is_live || aweme.isLive) {
      return { error: { code: "LIVE_STORY", message: "Khong ho tro Live/Story" } };
    }

    if (aweme.status?.private_status === 1 || aweme.author?.secret) {
      return { error: { code: "PRIVATE_OR_LOGIN_REQUIRED", message: "Video private" } };
    }

    const video = aweme.video;
    if (!video) {
      return { error: { code: "SCHEMA_CHANGED", message: "Khong tim thay du lieu video" } };
    }

    const playUrls = video.play_addr?.url_list || [];
    const downloadUrls = video.download_addr?.url_list || [];
    const candidateUrls = [...playUrls, ...downloadUrls];
    const noWatermarkUrl = playUrls[0] || null;
    const bestUrl = playUrls[0] || downloadUrls[0] || null;

    if (!bestUrl) {
      return { error: { code: "FORMAT_UNSUPPORTED", message: "Video dang stream" } };
    }

    const author = aweme.author?.nickname || aweme.author?.unique_id || "";
    const title = aweme.desc || "";
    const thumbnailUrl =
      video.cover?.url_list?.[0] ||
      video.origin_cover?.url_list?.[0] ||
      video.dynamic_cover?.url_list?.[0] ||
      "";

    return {
      platform: "douyin",
      pageUrl,
      video: {
        id: String(aweme.aweme_id || aweme.awemeId || videoId),
        author,
        title,
        thumbnailUrl,
        noWatermarkUrl: noWatermarkUrl || null,
        bestUrl,
        format: getFormat(bestUrl)
      },
      source: {
        kind: sourceKind,
        extractedAt: Date.now()
      },
      candidateUrls
    };
  }

  window.__TTDD_extractDouyin = extractDouyin;
})();
