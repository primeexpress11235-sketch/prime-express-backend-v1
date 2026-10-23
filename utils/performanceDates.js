const RANKING_HOUR = 17;

export const TIME_ZONE = 'Asia/Karachi';

function zonedParts(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value).reduce((result, part) => {
    if (part.type !== 'literal') result[part.type] = Number(part.value);
    return result;
  }, {});
}

export function dateBucket(timestamp = new Date()) {
  const value = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(value.getTime())) return null;
  const parts = zonedParts(value);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function today(now = new Date()) {
  return dateBucket(now);
}

function localDateParts(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateBucket(value) || '');
  return match ? match.slice(1).map(Number) : null;
}

function utcForLocalDateTime(year, month, day, hour = 0, minute = 0) {
  const desiredLocalTimestamp = Date.UTC(year, month - 1, day, hour, minute);
  let timestamp = desiredLocalTimestamp;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = zonedParts(new Date(timestamp));
    const renderedLocalTimestamp = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    const correction = desiredLocalTimestamp - renderedLocalTimestamp;
    timestamp += correction;
    if (correction === 0) break;
  }
  return new Date(timestamp);
}

export function dateBucketStart(timestamp = new Date()) {
  const parts = localDateParts(timestamp);
  return parts ? utcForLocalDateTime(...parts) : null;
}

export function dateBucketWindow(value = today()) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!match) return dateBucketWindow(today());
  const [year, month, day] = match.slice(1).map(Number);
  const start = utcForLocalDateTime(year, month, day);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  const end = utcForLocalDateTime(nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate());
  return { key: value, start, end };
}

export function calendarMonthBounds(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(value || '');
  const now = zonedParts();
  const year = match ? Number(match[1]) : now.year;
  const month = match ? Number(match[2]) : now.month;
  const start = utcForLocalDateTime(year, month, 1);
  const nextMonth = new Date(Date.UTC(year, month, 1));
  const end = utcForLocalDateTime(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth() + 1, 1);
  return { start, end, activityStart: start, activityEnd: end };
}

export function dateAtLocalTime(timestamp, time = '00:00') {
  const parts = localDateParts(timestamp);
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(String(time));
  if (!parts || !timeMatch) return null;
  return utcForLocalDateTime(...parts, Number(timeMatch[1]), Number(timeMatch[2]));
}

export function currentRankingWindow(now = new Date()) {
  const parts = zonedParts(now);
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (parts.hour < RANKING_HOUR) date.setUTCDate(date.getUTCDate() - 1);
  const start = utcForLocalDateTime(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), RANKING_HOUR);
  const endDate = new Date(date);
  endDate.setUTCDate(endDate.getUTCDate() + 1);
  const end = utcForLocalDateTime(endDate.getUTCFullYear(), endDate.getUTCMonth() + 1, endDate.getUTCDate(), RANKING_HOUR);
  return { key: date.toISOString().slice(0, 10), start, end };
}

export function rankingWindowForDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!match) return currentRankingWindow();
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + 1);
  return {
    key: value,
    start: utcForLocalDateTime(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), RANKING_HOUR),
    end: utcForLocalDateTime(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), RANKING_HOUR),
  };
}

export function pakistanMonthBounds(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(value || '');
  const now = zonedParts();
  const year = match ? Number(match[1]) : now.year;
  const month = match ? Number(match[2]) : now.month;
  const start = utcForLocalDateTime(year, month, 1, RANKING_HOUR);
  const endDate = new Date(Date.UTC(year, month, 1));
  return {
    start,
    end: utcForLocalDateTime(endDate.getUTCFullYear(), endDate.getUTCMonth() + 1, 1, RANKING_HOUR),
    activityStart: new Date(Date.UTC(year, month - 1, 1)),
    activityEnd: endDate,
  };
}

export function rankingDateFromNow(value = new Date()) {
  return currentRankingWindow(value).key;
}

export const pakistanDateKey = dateBucket;

export default {
  TIME_ZONE,
  dateBucket,
  today,
  dateBucketStart,
  dateBucketWindow,
  dateAtLocalTime,
  calendarMonthBounds,
  currentRankingWindow,
  rankingWindowForDate,
  pakistanMonthBounds,
  rankingDateFromNow,
  pakistanDateKey,
};
