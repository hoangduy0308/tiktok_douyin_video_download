const INVALID_CHARS = /[\\/:*?"<>|]/g;
const NON_ASCII = /[^\x20-\x7E]/g;

export function sanitizeName(input) {
  if (!input) return "";
  return input
    .replace(INVALID_CHARS, "_")
    .replace(NON_ASCII, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function getExtensionFromUrl(url) {
  if (!url) return "mp4";
  const clean = url.split("?")[0].toLowerCase();
  if (clean.endsWith(".m3u8")) return "m3u8";
  if (clean.endsWith(".mp4")) return "mp4";
  return "mp4";
}

export function buildFilename({ author, id, ext }) {
  const safeAuthor = sanitizeName(author || "");
  const safeId = sanitizeName(id || "");
  const base = [safeAuthor, safeId].filter(Boolean).join("_");
  const limited = base.slice(0, 100) || (safeId ? `video_${safeId}` : "video");
  const safeExt = ext || "mp4";
  return `${limited}.${safeExt}`;
}

export function sanitizeFilename(filename) {
  if (!filename) return "video.mp4";
  const parts = filename.split(".");
  if (parts.length === 1) {
    return `${sanitizeName(filename).slice(0, 100) || "video"}.mp4`;
  }
  const ext = parts.pop();
  const base = sanitizeName(parts.join("."));
  const trimmed = base.slice(0, 100) || "video";
  return `${trimmed}.${ext}`;
}
