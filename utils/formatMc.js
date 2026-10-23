export function formatMc(value) {
  if (value === null || value === undefined) return '';
  const digits = String(value)
    .trim()
    .replace(/^(?:MC[\s-]*)+/i, '')
    .replace(/\D/g, '');
  return digits ? `MC-${digits}` : '';
}

export default formatMc;
