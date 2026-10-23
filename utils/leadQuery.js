import { CARRIER_LEAD_STATUS_ENUM } from '../models/CarrierLead.js';

const CATEGORY_STATUS = {
  Untouched: 'Untouched',
  Interested: 'Interested',
  'Very Serious': 'Very Serious',
  'Follow Up': 'Follow Up/Busy',
  Spanish: 'Spanish',
  'Voicemail Sent': 'Voicemail Sent',
  'Asked for Text Msg': 'Asked for Text Msg',
  'Asked to Email': 'Asked for Email',
  'Not Picked Up': 'Not Picked Up',
  'Not Interested': 'Not Interested',
};
const MAX_LEAD_PAGE_SIZE = 100;

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function searchFilter(rawSearch) {
  const search = String(rawSearch || '').trim();
  if (!search) return null;

  if (/^\d+$/.test(search)) {
    const escapedDigits = escapeRegex(search);
    const separatedDigits = search.split('').map(escapeRegex).join('\\D*');
    return {
      $or: [
        { mcNumberDigits: { $regex: `^${escapedDigits}` } },
        { mcNumber: { $regex: `^(?:MC[-\\s]*)?${escapedDigits}`, $options: 'i' } },
        { dotNumberDigits: { $regex: `^${escapedDigits}` } },
        { dotNumber: { $regex: `^${escapedDigits}` } },
        { phoneDigits: { $regex: `^${escapedDigits}` } },
        { phone: { $regex: `^\\D*${separatedDigits}` } },
      ],
    };
  }

  const words = search.split(/\s+/).filter(Boolean);
  const companyMatch = { $and: words.map((word) => ({ companyName: { $regex: escapeRegex(word), $options: 'i' } })) };
  if (!search.includes('@')) return companyMatch;

  return {
    $or: [companyMatch, { email: { $regex: escapeRegex(search), $options: 'i' } }],
  };
}

export function buildLeadFilter(query = {}, user = {}, { ignoreStatus = false } = {}) {
  const filters = [];
  const search = searchFilter(query.search);
  if (search) filters.push(search);

  if (user.role === 'sales_agent') filters.push({ 'assignments.agentId': user._id });
  if (query.state) filters.push({ state: { $regex: `^${escapeRegex(query.state)}$`, $options: 'i' } });
  if (query.mcStatus) filters.push({ mcStatus: query.mcStatus });

  const currentStatus = ignoreStatus ? null : (query.currentStatus || CATEGORY_STATUS[query.category]);
  if (currentStatus && CARRIER_LEAD_STATUS_ENUM.includes(currentStatus)) {
    filters.push({ currentStatus });
  }

  if (query.assignedFilter === 'assigned') filters.push({ 'assignments.0': { $exists: true } });
  if (query.assignedFilter === 'unassigned') {
    filters.push({ $or: [{ assignments: { $size: 0 } }, { assignments: { $exists: false } }] });
  }
  if (query.agentId) filters.push({ 'assignments.agentId': query.agentId });

  if (filters.length === 0) return {};
  return filters.length === 1 ? filters[0] : { $and: filters };
}

export function getLeadPagination(query = {}) {
  const parsedPage = Number.parseInt(query.page, 10);
  const parsedLimit = Number.parseInt(query.limit, 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.min(parsedLimit, MAX_LEAD_PAGE_SIZE)
    : MAX_LEAD_PAGE_SIZE;
  return { page, limit, skip: (page - 1) * limit };
}
