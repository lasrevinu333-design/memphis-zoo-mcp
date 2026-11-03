// Presentation only: the source body and source revision remain unchanged.
// SQL finalization must derive this same prefix from the prepared source.
export function nativeAlertUtf8Prefix(value, maxBytes) {
  if (typeof value !== 'string' || !Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new Error('native_alert_text_invalid');
  }
  let result = '', used = 0;
  for (const point of value) {
    const code = point.codePointAt(0);
    if (code >= 0xd800 && code <= 0xdfff) throw new Error('native_alert_text_invalid');
    const bytes = Buffer.byteLength(point, 'utf8');
    if (used + bytes > maxBytes) break;
    result += point;
    used += bytes;
  }
  return result;
}

export function nativeAlertPreview(value, maxBytes) {
  const prefix = nativeAlertUtf8Prefix(value, maxBytes);
  if (prefix === value) return value;
  if (maxBytes < 3) throw new Error('native_alert_text_invalid');
  return nativeAlertUtf8Prefix(value, maxBytes - 3) + '…';
}
