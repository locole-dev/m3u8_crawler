/** Giờ HCM — không phụ thuộc timezone OS/server (Docker UTC vẫn đúng). */
export const HCM_TIMEZONE = 'Asia/Ho_Chi_Minh';

export function formatHcmTime(date = new Date()) {
  const formatted = new Intl.DateTimeFormat('sv-SE', {
    timeZone: HCM_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);

  return `${formatted.replace(' ', 'T')}+07:00`;
}

export function hcmLogPrefix(date = new Date()) {
  return `[${formatHcmTime(date)}]`;
}
