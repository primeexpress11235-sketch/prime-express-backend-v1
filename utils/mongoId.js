import mongoose from 'mongoose';

/**
 * Stable string id for Mongo ObjectIds (lowercase hex) and safe extraction from refs.
 */
export function toIdString(value) {
  if (value == null || value === '') return '';
  if (value instanceof mongoose.Types.ObjectId) return value.toString().toLowerCase();
  if (typeof value === 'object') {
    if (typeof value.toHexString === 'function') {
      return value.toHexString().toLowerCase();
    }
    if (value._id != null) return toIdString(value._id);
    if (value.id != null && typeof value.id !== 'object') return toIdString(value.id);
  }
  const s = String(value).trim();
  if (/^[a-fA-F0-9]{24}$/.test(s)) return s.toLowerCase();
  return s;
}
