export const ERROR_CODES = {
  NOT_VIDEO_PAGE: "NOT_VIDEO_PAGE",
  PHOTO_POST: "PHOTO_POST",
  LIVE_STORY: "LIVE_STORY",
  PRIVATE_OR_LOGIN_REQUIRED: "PRIVATE_OR_LOGIN_REQUIRED",
  PARSE_ERROR: "PARSE_ERROR",
  SCHEMA_CHANGED: "SCHEMA_CHANGED",
  DOWNLOAD_403: "DOWNLOAD_403",
  INTERRUPTED: "INTERRUPTED",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  FORMAT_UNSUPPORTED: "FORMAT_UNSUPPORTED",
  SHORT_URL_REDIRECTING: "SHORT_URL_REDIRECTING",
  CONTENT_SCRIPT_MISSING: "CONTENT_SCRIPT_MISSING"
};

const DEFAULT_MESSAGES = {
  NOT_VIDEO_PAGE: "Khong phat hien video",
  PHOTO_POST: "Bai nay la anh/carousel, hien chua ho tro.",
  LIVE_STORY: "Khong ho tro Live/Story.",
  PRIVATE_OR_LOGIN_REQUIRED: "Khong truy cap duoc video (private/doi dang nhap).",
  PARSE_ERROR: "Khong doc duoc du lieu video tu trang.",
  SCHEMA_CHANGED: "Trang da thay doi cau truc. Vui long thu lai.",
  DOWNLOAD_403: "Trinh duyet chan tai truc tiep. Dang thu che do tuong thich...",
  INTERRUPTED: "Tai bi gian doan. Kiem tra mang hoac quyen tai xuong.",
  TOKEN_EXPIRED: "Link het han. Bam lay lai link.",
  FORMAT_UNSUPPORTED: "Video dang stream, chua ho tro.",
  SHORT_URL_REDIRECTING: "Dang chuyen huong. Vui long doi redirect xong.",
  CONTENT_SCRIPT_MISSING: "Noi dung chua san sang. Hay tai lai trang va thu lai."
};

export function makeError(code, message) {
  return {
    code,
    message: message || DEFAULT_MESSAGES[code] || "Co loi xay ra"
  };
}
