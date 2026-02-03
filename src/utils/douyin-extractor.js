import {
  decodeMaybeBase64,
  collectVideoUrls,
  selectBestUrl,
  extractVideoId,
  getFormat
} from "./douyin-common.js";

const BROWSER_HEADERS = {
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
};

export function extractDouyinUrl(text) {
  if (!text) return null;

  const urlMatches = text.match(/https?:\/\/[^\s]+/gi) || [];
  const cleaned = urlMatches.map((u) =>
    u.replace(/[)\]}>,.，。！!؟；;]+$/g, "").trim()
  );

  const shortLink = cleaned.find((u) => {
    try {
      return new URL(u).hostname === "v.douyin.com";
    } catch {
      return false;
    }
  });
  if (shortLink) return shortLink;

  const longLink = cleaned.find((u) => {
    try {
      return new URL(u).hostname.endsWith("douyin.com");
    } catch {
      return false;
    }
  });
  return longLink || null;
}

export async function resolveDouyinShortUrl(shortUrl) {
  try {
    const res = await fetch(shortUrl, {
      redirect: "follow",
      credentials: "omit",
      headers: BROWSER_HEADERS
    });
    if (res.status === 403) {
      throw new Error("403: Anti-bot protection triggered");
    }
    return res.url;
  } catch (err) {
    if (err?.message?.includes("403")) {
      throw new Error("FETCH_403: Douyin blocked background fetch. Try using the extension on the video page directly.");
    }
    throw err;
  }
}

function extractRenderDataJson(html) {
  const m = html.match(
    /<script[^>]+id="RENDER_DATA"[^>]*>([\s\S]*?)<\/script>/i
  );
  if (!m) return null;
  let text = m[1].trim();

  text = text.replace(/\+/g, "%20");
  for (let i = 0; i < 3; i++) {
    if (!/%7B|%5B/i.test(text)) break;
    try {
      text = decodeURIComponent(text);
    } catch {
      break;
    }
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function findFirstVideoNode(obj) {
  if (!obj || typeof obj !== "object") return null;

  const video = obj.video;
  if (video?.play_addr?.url_list?.length || video?.download_addr?.url_list?.length || video?.main_url) return video;

  if (obj.play_addr?.url_list?.length || obj.download_addr?.url_list?.length) return obj;

  if (obj.playApi) {
    return { playApi: obj.playApi };
  }
  if (obj.play_url) {
    return { play_url: obj.play_url };
  }

  for (const k of Object.keys(obj)) {
    const found = findFirstVideoNode(obj[k]);
    if (found) return found;
  }
  return null;
}

function findVideoInfo(obj) {
  if (!obj || typeof obj !== "object") return null;

  if (obj.aweme_id && obj.desc !== undefined) {
    return {
      id: obj.aweme_id,
      title: obj.desc || "",
      author: obj.author?.nickname || obj.author?.unique_id || "",
      authorId: obj.author?.unique_id || obj.author?.sec_uid || ""
    };
  }

  for (const k of Object.keys(obj)) {
    const found = findVideoInfo(obj[k]);
    if (found) return found;
  }
  return null;
}

export async function getDouyinVideoInfo(pageUrl) {
  const videoId = extractVideoId(pageUrl);
  
  const apiResult = await tryDouyinApi(videoId);
  if (apiResult) {
    return apiResult;
  }

  const res = await fetch(pageUrl, {
    redirect: "follow",
    credentials: "include",
    headers: BROWSER_HEADERS
  });
  const html = await res.text();

  let data = extractRenderDataJson(html);
  
  if (!data) {
    const nextData = extractNextDataJson(html);
    if (nextData) {
      data = nextData;
    }
  }

  if (!data) {
    const routerData = extractRouterDataJson(html);
    if (routerData) {
      data = routerData;
    }
  }

  if (!data) {
    throw new Error("No video data found in page");
  }

  const video = findFirstVideoNode(data);
  if (!video) {
    throw new Error("Video node not found");
  }

  const urls = collectVideoUrls(video);

  if (!urls.length) {
    throw new Error("No video URLs found");
  }

  const info = findVideoInfo(data) || {};

  return {
    urls,
    id: info.id || videoId,
    title: info.title || "",
    author: info.author || "",
    authorId: info.authorId || ""
  };
}

async function tryDouyinApi(videoId) {
  if (!videoId || !/^\d+$/.test(videoId)) return null;
  
  const apiUrl = `https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids=${videoId}`;
  
  try {
    const res = await fetch(apiUrl, {
      headers: BROWSER_HEADERS
    });
    const json = await res.json();
    
    const item = json?.item_list?.[0];
    if (!item) return null;
    
    const video = item.video;
    if (!video) return null;
    
    const urls = collectVideoUrls(video);
    if (!urls.length) return null;
    
    return {
      urls,
      id: item.aweme_id || videoId,
      title: item.desc || "",
      author: item.author?.nickname || "",
      authorId: item.author?.unique_id || ""
    };
  } catch {
    return null;
  }
}

function extractNextDataJson(html) {
  const m = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try {
    return JSON.parse(m[1].trim());
  } catch {
    return null;
  }
}

function extractRouterDataJson(html) {
  const m = html.match(/window\._ROUTER_DATA\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/i);
  if (!m) return null;
  try {
    let text = m[1];
    text = text.replace(/\+/g, "%20");
    for (let i = 0; i < 3; i++) {
      if (!/%7B|%5B/i.test(text)) break;
      try {
        text = decodeURIComponent(text);
      } catch {
        break;
      }
    }
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function processDouyinClipboard(clipboardText) {
  const shortUrl = extractDouyinUrl(clipboardText);
  if (!shortUrl) {
    throw new Error("No Douyin URL found in clipboard");
  }

  const finalUrl = await resolveDouyinShortUrl(shortUrl);
  const videoInfo = await getDouyinVideoInfo(finalUrl);
  const bestUrl = selectBestUrl(videoInfo.urls);

  return {
    ...videoInfo,
    pageUrl: finalUrl,
    bestUrl
  };
}
