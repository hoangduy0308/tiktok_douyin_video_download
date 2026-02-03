(function () {
  function extractJsonFromSigi(text) {
    if (!text) return null;
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    return text.slice(start, end + 1);
  }

  function getVideoIdFromUrl(url) {
    try {
      const match = url.match(/\/video\/(\d+)/);
      return match ? match[1] : "";
    } catch {
      return "";
    }
  }

  function pickBestUrl(video) {
    const candidateUrls = [];

    if (video?.playAddr) {
      if (typeof video.playAddr === "string") {
        candidateUrls.push(video.playAddr);
      } else if (Array.isArray(video.playAddr.urlList)) {
        candidateUrls.push(...video.playAddr.urlList);
      } else if (Array.isArray(video.playAddr.UrlList)) {
        candidateUrls.push(...video.playAddr.UrlList);
      }
    }

    if (Array.isArray(video?.playAddr?.urlList)) {
      candidateUrls.push(...video.playAddr.urlList);
    }

    const bitrateCandidates = [];
    if (Array.isArray(video?.bitrateInfo)) {
      for (const info of video.bitrateInfo) {
        const urls =
          info?.playAddr?.urlList ||
          info?.playAddr?.UrlList ||
          info?.PlayAddr?.UrlList ||
          [];
        const bitrate = info?.bitrate || info?.Bitrate || 0;
        for (const url of urls) {
          bitrateCandidates.push({ url, bitrate });
        }
      }
    }

    bitrateCandidates.sort((a, b) => b.bitrate - a.bitrate);
    const bestFromBitrate = bitrateCandidates.length > 0 ? bitrateCandidates[0].url : null;

    const bestUrl = bestFromBitrate || candidateUrls[0] || null;
    const noWatermarkUrl = candidateUrls[0] || null;

    return { candidateUrls, bestUrl, noWatermarkUrl };
  }

  function getFormat(url) {
    if (!url) return "unknown";
    const clean = url.split("?")[0].toLowerCase();
    if (clean.endsWith(".m3u8")) return "m3u8";
    if (clean.endsWith(".mp4")) return "mp4";
    return "unknown";
  }

  function extractTikTok(doc, pageUrl) {
    const videoId = getVideoIdFromUrl(pageUrl);
    if (!videoId) {
      return { error: { code: "NOT_VIDEO_PAGE", message: "Khong phat hien video" } };
    }

    const sigiEl = doc.getElementById("SIGI_STATE");
    const nextEl = doc.getElementById("__NEXT_DATA__");
    let data = null;
    let sourceKind = null;

    if (sigiEl) {
      try {
        const jsonText = extractJsonFromSigi(sigiEl.textContent || "");
        data = jsonText ? JSON.parse(jsonText) : null;
        sourceKind = "SIGI_STATE";
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

    let item = null;
    if (data.ItemModule) {
      item = data.ItemModule[videoId] || Object.values(data.ItemModule)[0];
    }

    if (!item && data?.props?.pageProps?.itemInfo?.itemStruct) {
      item = data.props.pageProps.itemInfo.itemStruct;
    }

    if (!item) {
      return { error: { code: "SCHEMA_CHANGED", message: "Khong tim thay video" } };
    }

    if (item.imagePost || item.imagePost?.images?.length) {
      return { error: { code: "PHOTO_POST", message: "Bai nay la anh/carousel" } };
    }

    if (item.isLive || item.isLiveStreaming) {
      return { error: { code: "LIVE_STORY", message: "Khong ho tro Live/Story" } };
    }

    if (item.privateItem || item.privateItem === 1) {
      return { error: { code: "PRIVATE_OR_LOGIN_REQUIRED", message: "Video private" } };
    }

    const video = item.video || item.videoInfo || item.itemStruct?.video;
    if (!video) {
      return { error: { code: "SCHEMA_CHANGED", message: "Khong tim thay du lieu video" } };
    }

    const { candidateUrls, bestUrl, noWatermarkUrl } = pickBestUrl(video);
    if (!bestUrl) {
      return { error: { code: "FORMAT_UNSUPPORTED", message: "Video dang stream" } };
    }

    const author =
      item.author ||
      item.authorName ||
      item.author?.uniqueId ||
      item.author?.nickname ||
      "";
    const title = item.desc || item.description || "";
    const thumbnailUrl =
      video.cover ||
      video.originCover ||
      video.dynamicCover ||
      (Array.isArray(video.cover?.urlList) ? video.cover.urlList[0] : null) ||
      "";

    return {
      platform: "tiktok",
      pageUrl,
      video: {
        id: String(videoId),
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

  window.__TTDD_extractTikTok = extractTikTok;
})();
