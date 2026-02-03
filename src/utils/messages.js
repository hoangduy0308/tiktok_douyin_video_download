export const MESSAGE_VERSION = 1;

export function createMessage(type, payload, requestId) {
  return {
    version: MESSAGE_VERSION,
    requestId,
    type,
    payload
  };
}

export function createResult(type, requestId, ok, payload, error) {
  const result = {
    version: MESSAGE_VERSION,
    requestId,
    type,
    ok: Boolean(ok)
  };
  if (ok) {
    result.payload = payload;
  } else if (error) {
    result.error = error;
  }
  return result;
}

export function isMessage(value, type) {
  return Boolean(value && value.version === MESSAGE_VERSION && value.type === type);
}
