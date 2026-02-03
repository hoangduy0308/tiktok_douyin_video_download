function storageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => resolve(result || {}));
  });
}

function storageSet(value) {
  return new Promise((resolve) => {
    chrome.storage.local.set(value, () => resolve());
  });
}

export async function loadDownloads() {
  const result = await storageGet(["downloads"]);
  return Array.isArray(result.downloads) ? result.downloads : [];
}

export async function saveDownloads(list) {
  const trimmed = trimTo50(list || []);
  await storageSet({ downloads: trimmed });
  return trimmed;
}

export function trimTo50(list) {
  const sorted = [...(list || [])].sort((a, b) => (b.time || 0) - (a.time || 0));
  return sorted.slice(0, 50);
}

export async function upsertRecord(record) {
  const list = await loadDownloads();
  const index = list.findIndex((item) => item.recordId === record.recordId);
  if (index >= 0) {
    list[index] = { ...list[index], ...record };
  } else {
    list.unshift(record);
  }
  return saveDownloads(list);
}

export async function updateRecordById(recordId, patch) {
  const list = await loadDownloads();
  const index = list.findIndex((item) => item.recordId === recordId);
  if (index >= 0) {
    list[index] = { ...list[index], ...patch };
    return saveDownloads(list);
  }
  return list;
}

export async function updateRecordByDownloadId(downloadId, patch) {
  const list = await loadDownloads();
  const index = list.findIndex((item) => item.downloadId === downloadId);
  if (index >= 0) {
    list[index] = { ...list[index], ...patch };
    return saveDownloads(list);
  }
  return list;
}

export async function updateRecordProgress(downloadId, progress) {
  return updateRecordByDownloadId(downloadId, { progress });
}

export async function updateRecordDownloadId(recordId, downloadId) {
  return updateRecordById(recordId, { downloadId });
}

export async function deleteRecord(recordId) {
  const list = await loadDownloads();
  const filtered = list.filter((item) => item.recordId !== recordId);
  return saveDownloads(filtered);
}

export async function clearDownloads() {
  return saveDownloads([]);
}
