/** Strip Vietnamese diacritics for loose matching */
export function normalizeForMatch(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Generic noise removal for any scraped listing title */
export function cleanGenericMatchTitle(title) {
  let cleaned = String(title || '');
  const noise = [
    /(?:^|\s)(?:Trực tiếp|Truc tiep|Xem trực tiếp|Xem truc tiep)(?:\s|$)/gi,
    /(?:^|\s)(?:Live|Trực tuyến|Xem ngay)(?:\s|$)/gi,
    /(?:^|\s)(?:Chất lượng cao|Full HD|HD|4K)(?:\s|$)/gi,
    /(?:^|\s)(?:Bình luận tiếng Việt|BLV tiếng Việt|Tiếng Việt)(?:\s|$)/gi,
    /(?:^|\s)(?:Sắp diễn ra|Sắp đấu|Sap dien ra|Kết thúc|Đã diễn ra)(?:\s|$)/gi,
    /(?:^|\s)Đặt cược(?:\s|$)/gi,
    /\s+Xem$/i,
    /^Xem\s+/i,
  ];

  for (const regex of noise) {
    cleaned = cleaned.replace(regex, ' ');
  }

  return cleaned.replace(/\s+/g, ' ').trim();
}

/** Hoiquan cards glue time+date like 12:0029/05/2026 or 18:3029/05 */
export function extractHoiquanSchedule(title) {
  const m = String(title || '').match(/(\d{1,2}):(\d{2})(\d{2})\/(\d{2})(?:\/(\d{4}))?/);
  if (!m) return null;

  const [, hour, minute, day, month, year] = m;
  const h = hour.padStart(2, '0');
  const min = minute.padStart(2, '0');
  const d = day.padStart(2, '0');
  const mo = month.padStart(2, '0');

  return year ? `${h}:${min} ${d}/${mo}/${year}` : `${h}:${min} ${d}/${mo}`;
}

function joinTitleParts(parts) {
  return parts.filter(Boolean).map((p) => p.trim()).filter(Boolean).join(' | ');
}

/** Hoiquan listing cards glue score, time, date and betting CTA into one string */
export function cleanHoiquanMatchTitle(title) {
  const raw = String(title || '');
  const schedule = extractHoiquanSchedule(raw);

  let t = cleanGenericMatchTitle(raw);
  if (!t) return t;

  const hasListingNoise =
    /\b(?:Tay\s+Vợt\s+Số|\d{1,2}\s*-\s*\d{1,2}|\d{1,2}:\d{2}\d{2}\/)\b/i.test(t) ||
    /\bĐặt cược\b/i.test(t);
  const scheduleAlreadyPresent = /\|\s*\d{1,2}:\d{2}\s+\d{2}\/\d{2}/.test(t);

  if (!hasListingNoise && scheduleAlreadyPresent) {
    return t.replace(/\s+/g, ' ').trim();
  }

  let blv = '';
  const blvMatch = t.match(/\bBLV\s+([A-Za-zÀ-ỹ0-9][A-Za-zÀ-ỹ0-9\s]{0,30}?)(?=\s*(?:\||$))/i);
  if (blvMatch) {
    blv = blvMatch[1].trim();
  }

  t = t.replace(/\bBLV\s+[A-Za-zÀ-ỹ0-9][A-Za-zÀ-ỹ0-9\s]{0,30}/gi, ' ');
  t = t.replace(/\s*\|\s*$/g, ' ');
  t = t.replace(/\bTay\s+Vợt\s+Số\s+\d+\b/gi, ' ');
  t = t.replace(/\b\d{1,2}\s*-\s*\d{1,2}\b/g, ' ');
  t = t.replace(/\d{1,2}:\d{2}\d{2}\/\d{2}(?:\/\d{4})?/g, ' ');
  t = t.replace(/\b\d{2}\/\d{2}\/\d{4}\b/g, ' ');
  t = t.replace(/\s+vs\s+\d{1,2}:\d{2}[\d/]*/gi, ' vs ');
  t = t.replace(/\s+vs\s*$/i, '');
  t = t.replace(/\s+/g, ' ').trim();

  const parts = [t];
  if (schedule) parts.push(schedule);
  if (blv) parts.push(`BLV ${blv}`);

  return joinTitleParts(parts);
}

export function cleanMatchTitle(title, { profile } = {}) {
  if (typeof profile?.cleanMatchTitle === 'function') {
    return profile.cleanMatchTitle(title);
  }
  return cleanGenericMatchTitle(title);
}
