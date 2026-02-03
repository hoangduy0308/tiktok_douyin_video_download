/**
 * DUPLICATION WARNING:
 * This content script contains utility functions duplicated from:
 * - src/utils/douyin-common.js
 * 
 * Content scripts cannot import ES modules, so logic is duplicated here.
 * When updating functions here, check if the same changes are needed in:
 * - src/utils/douyin-common.js
 * - src/utils/douyin-extractor.js
 * 
 * Duplicated functions: decodeRenderData, decodeMaybeBase64, getFormat,
 * collectUrlsFromAddr, buildPlayUrlFromUri
 */

(function () {
  if (window.__DOUYIN_EXTRACTOR_INJECTED__) return;
  window.__DOUYIN_EXTRACTOR_INJECTED__ = true;

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
      // Standard video page: /video/123456
      const match = url.match(/\/video\/(\d+)/);
      if (match) return match[1];

      // Modal overlay on search/other pages: ?modal_id=123456
      const urlObj = new URL(url);
      const modalId = urlObj.searchParams.get("modal_id");
      if (modalId && /^\d+$/.test(modalId)) return modalId;

      return "";
    } catch {
      return "";
    }
  }

  function getActiveVideoIdFromDom(doc) {
    // Try to find video ID from active/visible video container
    const selectors = [
      "[data-e2e='feed-active-video'] [data-e2e='video-id']",
      ".swiper-slide-active [data-e2e='video-id']",
      "[class*='active'] [data-aweme-id]",
      "[data-aweme-id]",
      "xg-video-container[data-aweme-id]",
      "[class*='playerContainer'] [data-aweme-id]",
      "[class*='video-card'][data-aweme-id]"
    ];
    
    for (const selector of selectors) {
      try {
        const el = doc.querySelector(selector);
        const id = el?.dataset?.awemeId || el?.getAttribute("data-aweme-id") || el?.textContent?.trim();
        if (id && /^\d+$/.test(id)) return id;
      } catch {}
    }

    // Try to find from video element's parent hierarchy
    const video = doc.querySelector("video[src], video[currentSrc]");
    if (video) {
      let parent = video.parentElement;
      for (let i = 0; i < 15 && parent; i++) {
        const awemeId = parent.dataset?.awemeId || parent.getAttribute?.("data-aweme-id");
        if (awemeId && /^\d+$/.test(awemeId)) return awemeId;
        parent = parent.parentElement;
      }
    }

    return "";
  }

  function getFormat(url) {
    if (!url) return "unknown";
    const clean = url.split("?")[0].toLowerCase();
    if (clean.endsWith(".m3u8")) return "m3u8";
    if (clean.endsWith(".mp4")) return "mp4";
    const lower = url.toLowerCase();
    if (lower.includes("mime_type=video_mp4") || lower.includes("format=mp4")) return "mp4";
    if (lower.includes("mime_type=video_m3u8") || lower.includes("format=m3u8")) return "m3u8";
    return "unknown";
  }

  function decodeMaybeBase64(value) {
    if (!value || typeof value !== "string") return null;
    if (value.startsWith("http")) return value;
    try {
      const decoded = atob(value);
      if (decoded && decoded.startsWith("http")) return decoded;
    } catch {
      return null;
    }
    return null;
  }

  function buildPlayUrlFromUri(uri) {
    if (!uri || typeof uri !== "string") return null;
    return `https://www.douyin.com/aweme/v1/play/?video_id=${encodeURIComponent(uri)}`;
  }

  function collectUrlsFromAddr(addr) {
    const urls = [];
    if (!addr) return urls;
    if (typeof addr === "string") {
      urls.push(addr);
      return urls;
    }

    const list = addr.url_list || addr.urlList || [];
    if (Array.isArray(list)) {
      for (const item of list) {
        if (typeof item === "string") {
          const decoded = decodeMaybeBase64(item);
          urls.push(decoded || item);
        }
      }
    }

    const main = addr.main_url || addr.mainUrl;
    const decodedMain = decodeMaybeBase64(main);
    if (decodedMain) urls.push(decodedMain);

    const uri = addr.uri || addr.uriList || addr.url_key || addr.urlKey;
    const fallback = buildPlayUrlFromUri(uri);
    if (fallback) urls.push(fallback);

    return urls.filter(Boolean);
  }

  function hasPlayableAddr(video) {
    if (!video || typeof video !== "object") return false;
    const addrs = [
      video.play_addr,
      video.download_addr,
      video.play_addr_265,
      video.play_addr_h264,
      video.play_addr_lowbr
    ];
    if (addrs.some((a) => collectUrlsFromAddr(a).length > 0)) return true;

    const br = Array.isArray(video.bit_rate) ? video.bit_rate : [];
    for (const item of br) {
      if (collectUrlsFromAddr(item?.play_addr).length > 0) return true;
    }
    return false;
  }

  function extractFromVideoTag(doc) {
    const videos = doc.querySelectorAll("video");
    for (const el of videos) {
      const src = el?.currentSrc || el?.src || "";
      if (src && src.startsWith("http") && !src.startsWith("blob:")) {
        return src;
      }
      
      const sources = el.querySelectorAll("source");
      for (const source of sources) {
        const srcAttr = source?.src || "";
        if (srcAttr && srcAttr.startsWith("http")) {
          return srcAttr;
        }
      }
    }
    return null;
  }

  function extractFromPerformance() {
    try {
      const entries = performance.getEntriesByType("resource");
      const videoUrls = entries
        .filter(e => 
          e.name.includes("douyinvod") || 
          e.name.includes("/aweme/") ||
          e.name.includes("play") ||
          (e.name.includes(".mp4") && !e.name.includes(".js"))
        )
        .map(e => e.name)
        .filter(url => url.startsWith("http"));
      
      const dominated = videoUrls.filter(url => 
        url.includes("douyinvod") || url.includes("/v1/play")
      );
      
      return dominated.length > 0 ? dominated[dominated.length - 1] : (videoUrls[videoUrls.length - 1] || null);
    } catch {
      return null;
    }
  }

  function tryParseJson(value) {
    if (!value || typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  function matchAwemeId(item, videoId) {
    if (!videoId) return true;
    const id = item?.aweme_id || item?.awemeId || item?.id;
    if (!id) return false;
    return String(id) === String(videoId);
  }

  function pickFromList(list, videoId) {
    if (!Array.isArray(list) || list.length === 0) return null;
    if (!videoId) return list[0];
    return list.find((item) => matchAwemeId(item, videoId)) || list[0];
  }

  function normalizeDirect(candidate) {
    if (!candidate) return null;
    const direct =
      candidate.aweme_detail ||
      candidate.awemeDetail ||
      candidate.aweme ||
      candidate.detail ||
      candidate.awemeInfo ||
      candidate.itemStruct ||
      candidate;
    return direct || null;
  }

  function findAweme(root, videoId) {
    const queue = [root];
    const seen = new Set();
    let steps = 0;
    let index = 0;
    let fallback = null;
    let fallbackNoUrl = null;
    while (index < queue.length && steps < 5000) {
      const node = queue[index++];
      steps += 1;
      if (!node) continue;

      if (typeof node === "string") {
        if (node.includes("aweme") || node.includes("video")) {
          const parsed = tryParseJson(node);
          if (parsed) queue.push(parsed);
        }
        continue;
      }

      if (typeof node !== "object") continue;
      if (seen.has(node)) continue;
      seen.add(node);

      const directCandidate = normalizeDirect(node);
      if (directCandidate?.video) {
        if (matchAwemeId(directCandidate, videoId)) {
          if (hasPlayableAddr(directCandidate.video)) return directCandidate;
          if (!fallbackNoUrl) fallbackNoUrl = directCandidate;
        }
        if (!fallback && hasPlayableAddr(directCandidate.video)) fallback = directCandidate;
      }

      if (node.video) {
        if (matchAwemeId(node, videoId)) {
          if (hasPlayableAddr(node.video)) return node;
          if (!fallbackNoUrl) fallbackNoUrl = node;
        }
        if (!fallback && hasPlayableAddr(node.video)) fallback = node;
      }

      const listCandidate =
        node.aweme_list ||
        node.awemeList ||
        node.list ||
        node.awemeListInfo?.aweme_list;
      const picked = pickFromList(listCandidate, videoId);
      if (picked?.video) {
        if (matchAwemeId(picked, videoId)) {
          if (hasPlayableAddr(picked.video)) return picked;
          if (!fallbackNoUrl) fallbackNoUrl = picked;
        }
        if (!fallback && hasPlayableAddr(picked.video)) fallback = picked;
      }

      if (node.data) queue.push(node.data);
      if (node.value) queue.push(node.value);
      if (node.state) queue.push(node.state);

      for (const key of Object.keys(node)) {
        const value = node[key];
        if (value && typeof value === "object") {
          queue.push(value);
        } else if (typeof value === "string" && (value.includes("aweme") || value.includes("video"))) {
          const parsed = tryParseJson(value);
          if (parsed) queue.push(parsed);
        }
      }
    }
    return fallback || fallbackNoUrl;
  }

  function pickFromNextData(data, videoId) {
    if (!data || typeof data !== "object") return null;
    let fallbackNoUrl = null;
    const candidates = [
      data?.props?.pageProps?.aweme_detail,
      data?.props?.pageProps?.awemeDetail,
      data?.props?.pageProps?.itemInfo?.itemStruct,
      data?.props?.pageProps?.data?.aweme_detail,
      data?.props?.pageProps?.data?.awemeDetail,
      data?.props?.pageProps?.data?.aweme,
      data?.props?.pageProps?.data?.detail
    ];
    for (const candidate of candidates) {
      const direct = normalizeDirect(candidate);
      if (direct?.video && matchAwemeId(direct, videoId)) {
        if (hasPlayableAddr(direct.video)) return direct;
        if (!fallbackNoUrl) fallbackNoUrl = direct;
      }
    }
    const listCandidates = [
      data?.props?.pageProps?.aweme_list,
      data?.props?.pageProps?.awemeList,
      data?.props?.pageProps?.data?.aweme_list,
      data?.props?.pageProps?.data?.awemeList
    ];
    for (const list of listCandidates) {
      const picked = pickFromList(list, videoId);
      if (picked?.video) {
        if (hasPlayableAddr(picked.video)) return picked;
        if (!fallbackNoUrl) fallbackNoUrl = picked;
      }
    }
    return fallbackNoUrl;
  }

  function extractDouyin(doc, pageUrl) {
    let videoId = getVideoIdFromUrl(pageUrl);
    
    if (!videoId) {
      videoId = getActiveVideoIdFromDom(doc);
    }
    
    const domUrl = extractFromVideoTag(doc);
    const perfUrl = extractFromPerformance();
    const fallbackUrl = perfUrl || domUrl;
    
    if (!videoId && !fallbackUrl) {
      return { error: { code: "NOT_VIDEO_PAGE", message: "Khong phat hien video" } };
    }
    
    if (!videoId && fallbackUrl) {
      return {
        platform: "douyin",
        pageUrl,
        video: {
          id: crypto.randomUUID().slice(0, 8),
          author: "",
          title: doc.title || "",
          thumbnailUrl: "",
          noWatermarkUrl: fallbackUrl,
          bestUrl: fallbackUrl,
          format: getFormat(fallbackUrl)
        },
        source: {
          kind: "PERF_FALLBACK",
          extractedAt: Date.now()
        },
        candidateUrls: [fallbackUrl]
      };
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

    let aweme = pickFromNextData(data, videoId);
    if (!aweme) {
      const root = Array.isArray(data) ? data : [data];
      for (const entry of root) {
        aweme = findAweme(entry, videoId);
        if (aweme) break;
      }
    }

    if (!aweme) {
      const fallback = perfUrl || domUrl;
      if (fallback) {
        return {
          platform: "douyin",
          pageUrl,
          video: {
            id: videoId,
            author: "",
            title: doc.title || "",
            thumbnailUrl: "",
            noWatermarkUrl: fallback,
            bestUrl: fallback,
            format: getFormat(fallback)
          },
          source: {
            kind: "PERF_FALLBACK",
            extractedAt: Date.now()
          },
          candidateUrls: [fallback]
        };
      }
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

    const playUrls = collectUrlsFromAddr(video.play_addr);
    const downloadUrls = collectUrlsFromAddr(video.download_addr);
    const playUrls265 = collectUrlsFromAddr(video.play_addr_265);
    const playUrlsH264 = collectUrlsFromAddr(video.play_addr_h264);
    const playUrlsLow = collectUrlsFromAddr(video.play_addr_lowbr);
    const bitRates = Array.isArray(video.bit_rate) ? video.bit_rate : [];

    const candidates = [];
    for (const url of playUrls) candidates.push({ url, source: "play", bitrate: 0 });
    for (const url of playUrls265) candidates.push({ url, source: "play265", bitrate: 0 });
    for (const url of playUrlsH264) candidates.push({ url, source: "playh264", bitrate: 0 });
    for (const url of playUrlsLow) candidates.push({ url, source: "playlow", bitrate: 0 });
    for (const url of downloadUrls) candidates.push({ url, source: "download", bitrate: 0 });
    for (const item of bitRates) {
      const urls = collectUrlsFromAddr(item?.play_addr);
      const bitrate = item?.bit_rate || item?.bitrate || 0;
      for (const url of urls) candidates.push({ url, source: "bitrate", bitrate });
    }

    const withFormat = candidates.map((entry) => ({
      ...entry,
      format: getFormat(entry.url)
    }));

    const mp4Candidates = withFormat.filter((entry) => entry.format === "mp4");
    const m3u8Candidates = withFormat.filter((entry) => entry.format === "m3u8");

    let bestUrl = null;
    if (mp4Candidates.length > 0) {
      mp4Candidates.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      bestUrl = mp4Candidates[0].url;
    } else if (m3u8Candidates.length > 0) {
      m3u8Candidates.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      bestUrl = m3u8Candidates[0].url;
    } else if (withFormat.length > 0) {
      bestUrl = withFormat[0].url;
    }

    const noWatermarkUrl =
      playUrls[0] || playUrls265[0] || playUrlsH264[0] || playUrlsLow[0] || null;
    const candidateUrls = withFormat.map((entry) => entry.url);

    if (!bestUrl) {
      const fallbackUrl = perfUrl || extractFromVideoTag(doc);
      if (fallbackUrl) {
        bestUrl = fallbackUrl;
      }
    }

    if (!bestUrl) {
      return { error: { code: "FORMAT_UNSUPPORTED", message: "Khong tim thay URL video" } };
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
