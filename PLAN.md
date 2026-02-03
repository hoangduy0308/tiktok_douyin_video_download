# Kế hoạch: Extension tải video TikTok/Douyin không watermark (Chrome/Edge, MV3)

## Tóm tắt
- Xây dựng extension MV3 cho Chrome/Edge với popup chính.
- Phát hiện video TikTok/Douyin trên tab hiện tại.
- Trích xuất URL video không watermark chất lượng cao từ JSON nhúng trong trang.
- Tải xuống qua `chrome.downloads` với fallback download trong page context.
- Lưu lịch sử tải trong `chrome.storage.local` và hiển thị trong popup.
- Hiển thị disclaimer sử dụng cho mục đích cá nhân.

## Phạm vi & mục tiêu thành công
- Hoạt động ổn định trên trang video công khai TikTok và Douyin.
- Tải được file video không watermark chất lượng cao.
- UI tiếng Việt, thao tác 1-2 click.
- Lưu lịch sử tải xuống (tên, tác giả, id, thời gian, URL, trạng thái).

## Cấu trúc thư mục
```
manifest.json
src/
  background/
    service-worker.js
    download-tracker.js  # arm matcher, handle onCreated/onChanged
  content/
    content.js
    extractors/
      tiktok.js          # extractTikTok(document, url)
      douyin.js          # extractDouyin(document, url)
  popup/
    popup.html
    popup.js
    popup.css
  utils/
    filename.js          # sanitize filename
    messages.js          # message schema helpers
    storage.js           # loadDownloads, saveDownloads, upsertRecord, trimTo50
    errors.js            # error codes enum + makeError helper
assets/
  icons/
    icon16.png
    icon48.png
    icon128.png
```

## Kiến trúc & luồng dữ liệu

### Luồng chính
1. Popup mở → lấy `activeTab` URL.
2. Popup gửi message `GET_VIDEO_INFO` đến content script.
3. Content script gọi extractor phù hợp (TikTok/Douyin) để trích xuất metadata.
4. Content script trả về `candidateUrls[]` + chọn `bestUrl` và `noWatermarkUrl`.
5. Popup hiển thị thông tin + nút "Tải".
6. Khi bấm Tải:
   - Popup gửi `DOWNLOAD_VIDEO` cho background.
   - Background dùng `chrome.downloads.download()`.
   - Nếu fail (403/interrupted) → gửi `DOWNLOAD_FALLBACK` về content script để tải trong page context.
7. Background lắng nghe `chrome.downloads.onChanged` để cập nhật trạng thái thật.
8. Background lưu/cập nhật bản ghi vào `chrome.storage.local`.

### Extractor TikTok
- Ưu tiên `#SIGI_STATE` → fallback `#__NEXT_DATA__`.
- Lấy videoId từ URL hiện tại (`/video/<id>`) để match đúng item trong `ItemModule`.
- Trích xuất: `video.playAddr` hoặc `video.playAddr.urlList[]`.
- Nếu có `bitrateInfo[]` → chọn MP4 bitrate cao nhất.
- Trả về `candidateUrls[]` để chọn best.

### Extractor Douyin
- Ưu tiên `#RENDER_DATA` → fallback `#__NEXT_DATA__`.
- **Quan trọng**: `RENDER_DATA` thường được encode → cần decode loop:
  ```js
  // Decode loop (tối đa 3 lần)
  let text = renderDataElement.textContent;
  for (let i = 0; i < 3; i++) {
    if (!text.includes('%7B') && !text.includes('%5B')) break;
    text = decodeURIComponent(text.replace(/\+/g, '%20'));
  }
  const data = JSON.parse(text);
  ```
- Trích xuất: `video.play_addr.url_list[]` (không watermark), fallback `video.download_addr.url_list[]`.
- Trả về `candidateUrls[]` để chọn best.

### Chọn URL tốt nhất
- Ưu tiên MP4 > m3u8.
- Ưu tiên bitrate cao nhất nếu có danh sách.
- `noWatermarkUrl`: field `play_addr` / `playAddr`.
- `bestUrl`: luôn có giá trị (fallback URL đầu tiên).

## Message Schema (v1)

### GET_VIDEO_INFO (popup → content)
```ts
{
  version: 1,
  requestId: string,
  type: "GET_VIDEO_INFO",
  payload: { preferNoWatermark: true }
}
```

### GET_VIDEO_INFO_RESULT (content → popup)
```ts
{
  version: 1,
  requestId: string,
  type: "GET_VIDEO_INFO_RESULT",
  ok: boolean,
  error?: { code: string, message: string },
  payload?: {
    platform: "tiktok" | "douyin",
    pageUrl: string,
    video: {
      id: string,
      author: string,
      title: string,
      thumbnailUrl: string,
      noWatermarkUrl: string | null,
      bestUrl: string,
      format: "mp4" | "m3u8" | "unknown"
    },
    source: {
      kind: "SIGI_STATE" | "NEXT_DATA" | "RENDER_DATA",
      extractedAt: number
    }
  }
}
```

### DOWNLOAD_VIDEO (popup → background)
```ts
{
  version: 1,
  requestId: string,
  type: "DOWNLOAD_VIDEO",
  payload: {
    platform: string,
    pageUrl: string,
    videoId: string,
    url: string,
    filename: string
  }
}
```

### DOWNLOAD_VIDEO_RESULT (background → popup)
```ts
{
  version: 1,
  requestId: string,
  type: "DOWNLOAD_VIDEO_RESULT",
  ok: boolean,
  error?: { code: string, message: string },
  payload?: { downloadId: number }
}
```

### DOWNLOAD_FALLBACK (background → content)
```ts
{
  version: 1,
  requestId: string,
  type: "DOWNLOAD_FALLBACK",
  payload: { url: string, filename: string }
}
```

## Storage Schema
```ts
// chrome.storage.local
{
  downloads: Array<{
    recordId: string,     // = requestId (unique, tránh trùng khi tải lại cùng video)
    downloadId?: number,  // từ chrome.downloads API
    id: string,           // videoId
    platform: "tiktok" | "douyin",
    title: string,
    author: string,
    url: string,
    filename: string,     // filename thật sau download
    time: number,         // timestamp
    status: "pending" | "in_progress" | "complete" | "interrupted",
    method: "downloads_api" | "fallback_anchor",
    progress?: {
      bytesReceived: number,
      totalBytes: number,
      percent: number
    },
    lastError?: {
      code: string,
      message: string
    }
  }>  // Tối đa 50 mục, xóa cũ trước
}
```

## Đồng bộ trạng thái Download ↔ UI

### Popup lắng nghe storage
```js
// Popup render từ storage
chrome.storage.local.get(['downloads'], (result) => {
  renderHistory(result.downloads || []);
});

// Popup lắng nghe thay đổi realtime
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.downloads) {
    renderHistory(changes.downloads.newValue || []);
  }
});
```

### Background cập nhật storage
```js
chrome.downloads.onChanged.addListener(async (delta) => {
  if (delta.state || delta.filename || delta.error) {
    // Tìm record theo downloadId, cập nhật status/filename/error
    await updateRecordByDownloadId(delta.id, delta);
  }
});

// Cập nhật progress (nếu cần %)
chrome.downloads.onChanged.addListener(async (delta) => {
  if (delta.bytesReceived) {
    const [item] = await chrome.downloads.search({ id: delta.id });
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
```

## Fallback Download - Bắt downloadId

### Cơ chế arm matcher
```js
// Khi trigger fallback, arm matcher trong 5s
const pendingFallbacks = new Map(); // url -> { recordId, timeout }

function armFallbackMatcher(url, recordId) {
  pendingFallbacks.set(url, {
    recordId,
    timeout: setTimeout(() => pendingFallbacks.delete(url), 5000)
  });
}

// Lắng nghe download mới
chrome.downloads.onCreated.addListener((item) => {
  const pending = pendingFallbacks.get(item.url);
  if (pending) {
    clearTimeout(pending.timeout);
    pendingFallbacks.delete(item.url);
    // Cập nhật record với downloadId
    updateRecordDownloadId(pending.recordId, item.id);
  }
});
```

## Giao diện (popup) - Chi tiết UX/UI

### Kích thước & Layout
- **Width cố định:** 360px
- **Height tối đa:** 560px (nội dung scroll nếu cần)
- **Padding:** 12px; khoảng cách section: 12-16px

### Cấu trúc tổng thể (vertical)
```
┌──────────────────────────────────┐
│ [icon] Tải TikTok/Douyin   ↻  ⋯  │  Header (sticky)
│ Đã trích xuất: 6s trước • TikTok │
├──────────────────────────────────┤
│ PHÁT HIỆN VIDEO                  │  Section A
│ [thumb]  Tiêu đề video...        │
│          @tacgia                 │
│          MP4 • Không watermark   │
│ [        Tải video        ]      │  Primary CTA
│  Đang tải... 35%                 │  Inline feedback
├──────────────────────────────────┤
│ LỊCH SỬ TẢI                 Xóa  │  Section B
│ [t] Video A...   2p   Hoàn tất   │
│ [t] Video B...   1h   Bị lỗi     │
│ ...                              │
├──────────────────────────────────┤
│ Chỉ dùng cho mục đích cá nhân... │  Footer (sticky)
└──────────────────────────────────┘
```

### Section A - Header (sticky)
- Trái: icon extension + tên "Tải TikTok/Douyin"
- Phải: nút ↻ (Lấy lại link) + menu ⋯ (Xóa lịch sử)
- Dòng phụ: trạng thái nguồn (VD: "Đã trích xuất: 6s trước • TikTok")

### Section B - Video Card
| Thành phần | Chi tiết |
|------------|----------|
| Thumbnail | 64x64px, bo góc 10px |
| Title | 2 dòng, ellipsis nếu dài |
| Author | 1 dòng, prefix @ |
| Meta | "MP4 • Không watermark" hoặc "MP4 • Có thể có watermark" |
| CTA chính | Nút full-width "Tải video" (primary) |
| CTA phụ | Link nhỏ "Sao chép link" (optional) |
| Progress | Inline ngay dưới CTA khi đang tải |

### Section C - Lịch sử tải
| Thành phần | Chi tiết |
|------------|----------|
| Header | "Lịch sử tải" + nút Xóa (icon thùng rác) |
| Item thumbnail | 40x40px |
| Item info | Title (1 dòng) + time ("2 phút trước") |
| Badge trạng thái | Hoàn tất (green), Đang tải (blue), Bị gián đoạn (red), Fallback (amber) |
| Actions | Ẩn mặc định, hiện khi hover/click: Mở file, Mở thư mục, Tải lại, Xóa |

### Section D - Footer (sticky/fixed)
- Text: "Chỉ dùng cho mục đích cá nhân. Không hỗ trợ video private/paid."
- Link: "Tìm hiểu thêm" (optional)

---

## Trạng thái UI

### Trạng thái tổng (khi mở popup)

| Trạng thái | UI | Copy |
|------------|-----|------|
| Loading | Skeleton card (ô xám) + nút disabled | "Đang phát hiện video trên tab hiện tại…" |
| Success | Video Card đầy đủ + CTA | Hiển thị thông tin video |
| Empty | Icon empty + text | "Không phát hiện video. Hãy mở trang video TikTok/Douyin công khai." |
| Error | Alert box + icon cảnh báo | Message lỗi + mã lỗi copyable |

### Trạng thái download

| Trạng thái | Nút CTA | Badge lịch sử |
|------------|---------|---------------|
| pending | Spinner + "Đang chuẩn bị…" | — |
| in_progress | Progress + "Đang tải…" | 🔵 Đang tải + % |
| complete | "Tải lại" + "Mở file" | 🟢 Hoàn tất |
| interrupted | "Tải lại" | 🔴 Bị gián đoạn |
| fallback | Badge "Fallback" | 🟠 Fallback |

---

## Error States & Empty States

### Nhóm "Không hỗ trợ"
| Mã lỗi | Message |
|--------|---------|
| NOT_VIDEO_PAGE | "Không phát hiện video" |
| PHOTO_POST | "Bài này là ảnh/carousel, hiện chưa hỗ trợ." |
| LIVE_STORY | "Không hỗ trợ Live/Story." |

### Nhóm "Không truy cập được"
| Mã lỗi | Message |
|--------|---------|
| PRIVATE_OR_LOGIN_REQUIRED | "Không truy cập được video (private/đòi đăng nhập). Hãy đăng nhập và mở video công khai." |

### Nhóm "Kỹ thuật"
| Mã lỗi | Message |
|--------|---------|
| PARSE_ERROR | "Không đọc được dữ liệu video từ trang." |
| SCHEMA_CHANGED | "Trang đã thay đổi cấu trúc. Vui lòng thử ↻ hoặc cập nhật extension." |

### Nhóm download
| Mã lỗi | Message |
|--------|---------|
| DOWNLOAD_403 | "Trình duyệt chặn tải trực tiếp. Đang thử chế độ tương thích…" |
| INTERRUPTED | "Tải bị gián đoạn. Kiểm tra mạng hoặc quyền tải xuống." |
| TOKEN_EXPIRED | "Link hết hạn. Bấm ↻ lấy lại link." |

---

## Micro-interactions & Feedback

### Nút "Tải video"
1. Click → Disable 800-1200ms (chống double click)
2. Label đổi: "Đang tải…" + spinner
3. Khi có downloadId → show inline status
4. Hoàn tất → "Tải lại" + "Mở file"

### Nút "↻ Lấy lại link"
- Hover tooltip: "Trích xuất lại từ trang"
- Click → skeleton + reset error + refresh timestamp

### History item
- Click → mở action row (accordion)
- "Xóa" cần confirm 2 bước: Xóa? [Hủy] [Xóa]

### Toast (2-3s)
- "Đã sao chép link"
- "Tải xong"
- "Tải thất bại"
- "Đã xóa khỏi lịch sử"

---

## Color Scheme

### Base colors
| Vai trò | Màu |
|---------|-----|
| Nền | #FFFFFF |
| Surface (card/list) | #F6F7F9 |
| Border | #E6E8EE |
| Text chính | #111827 |
| Text phụ | #6B7280 |

### Semantic colors
| Vai trò | Màu |
|---------|-----|
| Primary (CTA) | #2563EB |
| Success | #16A34A |
| Warning/Fallback | #D97706 |
| Error | #DC2626 |
| Focus ring | #93C5FD |

---

## Typography
- **Font:** `system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`
- **Base:** 14px
- **Title:** 14px semibold (600)
- **Author/meta:** 12px regular
- **Disclaimer:** 11-12px, line-height 1.3
- **Line-height body:** 1.4-1.5

---

## Responsive & Constraints
- Min width 320px: thumbnail 56x56, title 1 dòng
- Long title/author: ellipsis, không wrap vô hạn
- History có max-height và scroll riêng
- Icon SVG hoặc PNG @2x cho High DPI

---

## Accessibility
- **Tab order:** Refresh → CTA Tải → Sao chép link → History items → Footer link
- **Focus visible:** outline 2px, không bỏ mặc định
- **ARIA:**
  - `aria-live="polite"` cho status text
  - Buttons có `aria-label` rõ ràng
- **Contrast:** ≥ WCAG AA
- **Reduced motion:** tôn trọng `prefers-reduced-motion`

---

## Animation & Transitions
| Animation | Duration | Ghi chú |
|-----------|----------|---------|
| Skeleton shimmer | 800-1200ms loop | Tắt nếu reduced motion |
| Fade in (loading → content) | 120-180ms | Tránh giật |
| Progress bar | 150ms | Tăng mượt |
| Toast slide/fade | 180ms | Không che CTA |

---

## User Flow Chi tiết

### Flow A - Tải video (happy path, 1 click)
1. User ở trang video TikTok/Douyin → mở popup
2. Popup auto gửi `GET_VIDEO_INFO`
3. UI: skeleton 0.3-1.5s → hiện Video Card
4. User bấm **"Tải video"** ← 1 click
5. UI: nút "Đang tải…", tạo record pending trong lịch sử
6. Background trả downloadId → update trạng thái
7. `onChanged` báo complete → Toast "Tải xong" + badge "Hoàn tất"

### Flow B - Link hết hạn (2 click)
1. Popup mở, detect ok nhưng download fail "Link hết hạn"
2. UI error + CTA **"↻ Lấy lại link"**
3. User bấm ↻ ← click 1 → detect lại
4. User bấm "Tải video" ← click 2

### Flow C - Không ở trang video
1. Popup mở → detect → empty state
2. User chuyển tab sang trang video → mở popup lại hoặc bấm ↻

## Manifest & quyền (hoàn chỉnh)
```json
{
  "manifest_version": 3,
  "name": "TikTok/Douyin Downloader",
  "version": "1.0.0",
  "description": "Tải video TikTok/Douyin không watermark",
  "action": {
    "default_title": "Tải TikTok/Douyin",
    "default_popup": "src/popup/popup.html",
    "default_icon": {
      "16": "assets/icons/icon16.png",
      "48": "assets/icons/icon48.png",
      "128": "assets/icons/icon128.png"
    }
  },
  "icons": {
    "16": "assets/icons/icon16.png",
    "48": "assets/icons/icon48.png",
    "128": "assets/icons/icon128.png"
  },
  "background": {
    "service_worker": "src/background/service-worker.js",
    "type": "module"
  },
  "permissions": [
    "activeTab",
    "downloads",
    "storage"
  ],
  "host_permissions": [
    "https://www.tiktok.com/*",
    "https://www.douyin.com/*",
    "https://vt.tiktok.com/*",
    "https://vm.tiktok.com/*",
    "https://v.douyin.com/*"
  ],
  "content_scripts": [
    {
      "matches": [
        "https://www.tiktok.com/*",
        "https://www.douyin.com/*",
        "https://vt.tiktok.com/*",
        "https://vm.tiktok.com/*",
        "https://v.douyin.com/*"
      ],
      "js": ["src/content/content.js"],
      "run_at": "document_idle"
    }
  ]
}
```

**Ghi chú MV3:**
- Popup phải dùng `<script src="popup.js">`, không dùng inline script
- Service worker có thể sleep, nên dùng storage làm source of truth
- Không cần `scripting` permission vì dùng `content_scripts` khai báo sẵn

## Xử lý lỗi & edge cases

### Trang/nội dung
| Case | Xử lý |
|------|-------|
| Không ở trang video | Hiển thị "Không phát hiện video" |
| Photo post / carousel | Hiển thị "Không phải video, không hỗ trợ" |
| Live / story | Hiển thị "Không hỗ trợ live/story" |
| Video private/paid | Hiển thị "Không truy cập được (private/paid)" |
| Short URL (vt.tiktok.com, v.douyin.com) | Content script match được, nhưng thường chỉ là redirect → trả `SHORT_URL_REDIRECTING` + hướng dẫn đợi redirect |
| Chỉ có m3u8, không có MP4 | Trả `FORMAT_UNSUPPORTED` + message "Video dạng stream, chưa hỗ trợ" |

### Parse JSON
| Case | Xử lý |
|------|-------|
| JSON không parse được | Báo lỗi + code `PARSE_ERROR` |
| Schema thay đổi / field không tìm thấy | Log `sourceKind` + báo lỗi `SCHEMA_CHANGED` |
| RENDER_DATA cần decode | Tự động `decodeURIComponent()` 1-2 lần |

### Download
| Case | Xử lý |
|------|-------|
| 403 / hotlink blocked | Fallback download trong page context |
| URL hết hạn (token expired) | Hiển thị "Link hết hạn" + nút "Lấy lại link" |
| Click nhiều lần | Chống trùng bằng videoId + timestamp |

### SPA Navigation
| Case | Xử lý |
|------|-------|
| User chuyển video không reload | Lấy videoId từ URL mỗi lần bấm, nếu mismatch với state → báo user reload hoặc bấm "Lấy lại link" |

## Filename Sanitization
- Mẫu: `{author}_{id}.mp4`
- Loại bỏ ký tự đặc biệt: `\ / : * ? " < > |`
- Xử lý emoji/unicode lạ → thay bằng `_`
- Giới hạn độ dài: 100 ký tự (không tính extension)
- Tránh tên rỗng: fallback `video_{id}.mp4`

## Download Strategy (2 bước)

### Bước 1: chrome.downloads.download()
```js
chrome.downloads.download({
  url: bestUrl,
  filename: sanitizedFilename,
  saveAs: false
});
```

### Bước 2: Fallback (nếu bước 1 fail)
Content script tạo download trong page context:
```js
const a = document.createElement('a');
a.href = videoUrl;
a.download = filename;
a.click();
```
→ Request có referer/cookie hợp lệ.

### Lắng nghe trạng thái
```js
chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state) {
    // Cập nhật status trong storage
  }
  if (delta.filename) {
    // Cập nhật filename thật
  }
});
```

## Kiểm thử thủ công
- [ ] TikTok video công khai (desktop web)
- [ ] Douyin video công khai
- [ ] TikTok/Douyin từ short URL (vt.tiktok.com, v.douyin.com)
- [ ] Trang không phải video (homepage/search)
- [ ] Photo post / carousel
- [ ] Video yêu cầu login / private
- [ ] Tải thành công và xuất hiện trong lịch sử
- [ ] Lịch sử còn sau khi đóng/mở trình duyệt
- [ ] Fallback download khi bị 403
- [ ] SPA navigation (chuyển video không reload)
- [ ] Filename với ký tự đặc biệt/emoji

## Giả định & mặc định
- Tên extension: "TikTok/Douyin Downloader"
- Filename mặc định: `{author}_{id}.mp4` (sanitize ký tự)
- Lịch sử lưu tối đa 50 mục (xóa cũ trước)
- UI tiếng Việt mặc định, chưa làm chuyển ngôn ngữ
- Disclaimer hiển thị trong popup, không chặn thao tác

## Thứ tự implement (đề xuất)

| Bước | Module | Mô tả |
|------|--------|-------|
| 1 | `src/utils/errors.js` | Error codes enum + `makeError()` helper |
| 2 | `src/utils/storage.js` | `loadDownloads()`, `upsertRecord()`, `trimTo50()` |
| 3 | `src/content/extractors/tiktok.js` | Extract từ SIGI_STATE/NEXT_DATA |
| 4 | `src/content/extractors/douyin.js` | Extract từ RENDER_DATA (có decode loop) |
| 5 | `src/content/content.js` | Xử lý `GET_VIDEO_INFO` message |
| 6 | `src/popup/popup.html + popup.css` | Layout + states (Loading/Success/Empty/Error) |
| 7 | `src/popup/popup.js` | Gửi message, render Video Card, lắng nghe storage |
| 8 | `src/background/service-worker.js` | `DOWNLOAD_VIDEO` + `downloads.onChanged` |
| 9 | `src/background/download-tracker.js` | Fallback arm matcher + `onCreated` |
| 10 | History UI | Render list + actions (Open/Retry/Delete) |
| 11 | Polish | Progress %, toast, accessibility |

## Ước lượng effort
| Phạm vi | Thời gian |
|---------|-----------|
| Bản MVP (chạy được trên video công khai) | 1-3 giờ |
| Bản ổn định (SPA + fallback + multi-domain) | 1-2 ngày |

## Rủi ro & guardrails
| Rủi ro | Guardrail |
|--------|-----------|
| Schema TikTok/Douyin thay đổi | Bọc parse bằng try/catch, log sourceKind |
| Token URL hết hạn nhanh | Hiển thị "Trích xuất lúc X giây trước" + nút "Lấy lại link" |
| Download bị block nhiều | Fallback page context, nếu vẫn fail > 20-30% → xem xét declarativeNetRequest |
| Legal/ToS | Disclaimer rõ ràng, không hỗ trợ video private/paid |
