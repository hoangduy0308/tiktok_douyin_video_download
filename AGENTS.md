# AGENTS.md - TikTok/Douyin Downloader Extension

## Commands
- **Test:** `node tests/run-tests.mjs` (runs all tests)
- **Load extension:** Chrome → `chrome://extensions` → Load unpacked → select project root

## Architecture
Chrome extension (Manifest V3) for downloading TikTok/Douyin videos without watermark.
- `src/background/` - Service worker handles downloads via `chrome.downloads` API
- `src/content/` - Content scripts extract video URLs from page JSON (`SIGI_STATE`, `RENDER_DATA`)
- `src/content/extractors/` - Platform-specific extractors (tiktok.js, douyin.js)
- `src/popup/` - Extension popup UI (HTML/CSS/JS)
- `src/utils/` - Shared utilities (storage, filename sanitization, error handling, messages)

## Code Style
- Vanilla JavaScript (ES modules with `type: "module"`)
- No build step; files loaded directly by browser
- Use `export`/`import` for utils; extractors expose via `window.__TTDD_*` for content scripts
- Error handling: use `ERROR_CODES` enum and `makeError()` from `src/utils/errors.js`
- Filename format: `{author}_{id}.mp4` with sanitized special chars
- Vietnamese UI text; no i18n yet
- No comments unless code is complex
