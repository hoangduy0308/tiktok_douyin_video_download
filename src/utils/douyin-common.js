/**
 * DUPLICATION WARNING:
 * This file contains shared utility functions for Douyin video extraction.
 * Similar logic exists in src/content/extractors/douyin.js (content script).
 * 
 * Content scripts cannot import ES modules, so logic is duplicated.
 * When updating functions here, check if the same changes are needed in:
 * - src/content/extractors/douyin.js
 * 
 * Shared functions: decodeRenderData, decodeMaybeBase64, getFormat,
 * collectUrlsFromAddr, collectVideoUrls, selectBestUrl
 */

export function decodeRenderData(text) {
  let result = text || "";
  for (let i = 0; i < 3; i++) {
    if (!result.includes("%7B") && !result.includes("%5B")) break;
    result = decodeURIComponent(result.replace(/\+/g, "%20"));
  }
  return result;
}

export function decodeMaybeBase64(value) {
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

export function buildPlayUrlFromUri(uri) {
  if (!uri || typeof uri !== "string") return null;
  return `https://www.douyin.com/aweme/v1/play/?video_id=${encodeURIComponent(uri)}`;
}

export function getFormat(url) {
  if (!url) return "unknown";
  const clean = url.split("?")[0].toLowerCase();
  if (clean.endsWith(".m3u8")) return "m3u8";
  if (clean.endsWith(".mp4")) return "mp4";
  const lower = url.toLowerCase();
  if (lower.includes("mime_type=video_mp4") || lower.includes("format=mp4")) return "mp4";
  if (lower.includes("mime_type=video_m3u8") || lower.includes("format=m3u8")) return "m3u8";
  return "unknown";
}

export function collectUrlsFromAddr(addr) {
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
  if (uri && uri.startsWith("http")) {
    urls.push(uri);
  }
  const fallback = buildPlayUrlFromUri(uri);
  if (fallback) urls.push(fallback);

  return urls.filter(Boolean);
}

export function collectVideoUrls(video) {
  const urls = [];

  const addFromAddr = (addr) => {
    const collected = collectUrlsFromAddr(addr);
    urls.push(...collected);
  };

  addFromAddr(video.play_addr);
  addFromAddr(video.download_addr);
  addFromAddr(video.play_addr_265);
  addFromAddr(video.play_addr_h264);
  addFromAddr(video.play_addr_lowbr);

  if (video.bit_rate?.length) {
    for (const br of video.bit_rate) {
      addFromAddr(br.play_addr);
    }
  }

  if (video.playApi) urls.push(video.playApi);
  if (video.play_url) urls.push(video.play_url);

  return [...new Set(urls.filter(Boolean))];
}

export function selectBestUrl(urls) {
  const withFormat = urls.map((url) => ({ url, format: getFormat(url) }));
  
  const mp4Urls = withFormat.filter((item) => item.format === "mp4");
  if (mp4Urls.length > 0) return mp4Urls[0].url;

  const unknownUrls = withFormat.filter((item) => item.format === "unknown");
  if (unknownUrls.length > 0) return unknownUrls[0].url;

  const m3u8Only = withFormat.every((item) => item.format === "m3u8");
  if (m3u8Only && urls.length > 0) {
    throw new Error("FORMAT_UNSUPPORTED: HLS streaming not supported");
  }
  
  return urls[0];
}

export function extractVideoId(url) {
  const m = url.match(/video\/(\d+)/);
  return m ? m[1] : crypto.randomUUID().slice(0, 8);
}
