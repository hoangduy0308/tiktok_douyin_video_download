import assert from "assert";
import { readFileSync } from "fs";
import vm from "vm";

import { buildFilename, getExtensionFromUrl, sanitizeName } from "../src/utils/filename.js";

function loadExtractor(filePath, exportName) {
  const code = readFileSync(filePath, "utf8");
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: filePath });
  const extractor = context.window[exportName];
  if (typeof extractor !== "function") {
    throw new Error(`Extractor ${exportName} not found in ${filePath}`);
  }
  return extractor;
}

function makeDoc(textMap) {
  return {
    getElementById(id) {
      if (!Object.prototype.hasOwnProperty.call(textMap, id)) return null;
      return { textContent: textMap[id] };
    },
    querySelectorAll() {
      return [];
    }
  };
}

function testFilename() {
  assert.equal(sanitizeName("a/b:c?d"), "a_b_c_d");
  assert.equal(getExtensionFromUrl("https://x/test.mp4?token=1"), "mp4");
  assert.equal(getExtensionFromUrl("https://x/test.m3u8"), "m3u8");
  const name = buildFilename({ author: "ta c?gia", id: "123", ext: "mp4" });
  assert.ok(name.endsWith(".mp4"));
  assert.ok(name.includes("123"));
}

function testTikTokExtractor() {
  const extractTikTok = loadExtractor("./src/content/extractors/tiktok.js", "__TTDD_extractTikTok");
  const data = {
    ItemModule: {
      "123": {
        desc: "Test video",
        author: "tester",
        video: {
          playAddr: { urlList: ["https://video.low.mp4"] },
          bitrateInfo: [
            { bitrate: 100, playAddr: { urlList: ["https://video.mid.mp4"] } },
            { bitrate: 200, playAddr: { urlList: ["https://video.best.mp4"] } }
          ],
          cover: "https://img.cover.jpg"
        }
      }
    }
  };
  const text = `window['SIGI_STATE']=${JSON.stringify(data)};`;
  const doc = makeDoc({ SIGI_STATE: text });
  const result = extractTikTok(doc, "https://www.tiktok.com/@user/video/123");
  assert.ok(!result.error, "should not error");
  assert.equal(result.video.bestUrl, "https://video.best.mp4");
  assert.equal(result.video.noWatermarkUrl, "https://video.low.mp4");
  assert.equal(result.video.id, "123");
}

function testDouyinExtractor() {
  const extractDouyin = loadExtractor("./src/content/extractors/douyin.js", "__TTDD_extractDouyin");
  const data = [
    {
      aweme_detail: {
        aweme_id: "999",
        desc: "Douyin test",
        author: { nickname: "douyin" },
        video: {
          play_addr: { url_list: ["https://douyin.play.mp4"] },
          download_addr: { url_list: ["https://douyin.download.mp4"] },
          cover: { url_list: ["https://douyin.cover.jpg"] }
        }
      }
    }
  ];
  const encoded = encodeURIComponent(JSON.stringify(data));
  const doc = makeDoc({ RENDER_DATA: encoded });
  const result = extractDouyin(doc, "https://www.douyin.com/video/999");
  assert.ok(!result.error, "should not error");
  assert.equal(result.video.bestUrl, "https://douyin.play.mp4");
  assert.equal(result.video.noWatermarkUrl, "https://douyin.play.mp4");
  assert.equal(result.video.id, "999");
}

function run() {
  testFilename();
  testTikTokExtractor();
  testDouyinExtractor();
  console.log("All tests passed.");
}

run();
