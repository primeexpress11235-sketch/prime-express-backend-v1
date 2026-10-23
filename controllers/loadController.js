import asyncHandler from 'express-async-handler';
import Load from '../models/Load.js';
import Carrier from '../models/Carrier.js';
import { recordLoad } from '../services/loadHistory.js';
import { success, error } from '../utils/sendResponse.js';

/**
 * Build date/month query filter for loads
 */
const buildDateFilter = (date, month, startDate, endDate) => {
  if (date) {
    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(`${date}T23:59:59.999Z`);
    return {
      $or: [
        { pickupDate: { $gte: start, $lte: end } },
        { pickupDate: null, createdAt: { $gte: start, $lte: end } },
      ],
    };
  }

  if (month) {
    const [year, monthNum] = month.split('-').map(Number);
    if (year && monthNum) {
      const start = new Date(Date.UTC(year, monthNum - 1, 1, 0, 0, 0, 0));
      const end = new Date(Date.UTC(year, monthNum, 0, 23, 59, 59, 999));
      return {
        $or: [
          { pickupDate: { $gte: start, $lte: end } },
          { pickupDate: null, createdAt: { $gte: start, $lte: end } },
        ],
      };
    }
  }

  if (startDate || endDate) {
    const pickupDateFilter = {};
    if (startDate) pickupDateFilter.$gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      pickupDateFilter.$lte = end;
    }
    return { pickupDate: pickupDateFilter };
  }

  return null;
};

/**
 * @route   GET /api/loads
 * @desc    List loads, filterable by ?dispatcher=:id, ?carrier=:id, ?status=..., ?search=..., ?date=YYYY-MM-DD, ?month=YYYY-MM
 * @access  Private/Admin
 */
export const getLoads = asyncHandler(async (req, res) => {
  const { dispatcher, carrier, status, search, startDate, endDate, date, month } = req.query;
  const query = {};
  if (dispatcher) query.dispatcher = dispatcher;
  if (carrier) query.carrier = carrier;
  if (status) query.status = status;

  const dateFilter = buildDateFilter(date, month, startDate, endDate);
  if (dateFilter) {
    if (dateFilter.$or) {
      query.$and = query.$and || [];
      query.$and.push({ $or: dateFilter.$or });
    } else if (dateFilter.pickupDate) {
      query.pickupDate = dateFilter.pickupDate;
    }
  }

  if (search && search.trim()) {
    const s = search.trim();
    const regex = new RegExp(s, 'i');

    const matchingCarriers = await Carrier.find({
      $or: [{ companyName: regex }, { mcNumber: regex }],
    }).select('_id');
    const carrierIds = matchingCarriers.map((c) => c._id);

    const searchCondition = {
      $or: [
        { carrierName: regex },
        { commodity: regex },
        { pickupLocation: regex },
        { deliveryLocation: regex },
        { invoiceNumber: regex },
        { broker: regex },
        ...(carrierIds.length > 0 ? [{ carrier: { $in: carrierIds } }] : []),
      ],
    };

    if (query.$and) {
      query.$and.push(searchCondition);
    } else {
      Object.assign(query, searchCondition);
    }
  }

  const loads = await Load.find(query)
    .populate('carrier', 'companyName mcNumber dotNumber phone email')
    .populate('dispatcher', 'name email')
    .populate('truck', 'truckNumber equipmentType driverName driverPhone')
    .populate('invoice', 'documentNumber fileUrl generatedAt')
    .sort('-pickupDate -createdAt');

  return success(res, 200, loads, 'Loads retrieved');
});

/**
 * @route   GET /api/loads/kpis
 * @desc    Get aggregated KPIs: Loads Booked and Total Dispatch Fee Collected (for paid loads)
 *          Filterable by ?carrier=:id, ?date=YYYY-MM-DD, ?month=YYYY-MM
 * @access  Private/Admin
 */
export const getLoadKPIs = asyncHandler(async (req, res) => {
  const { carrier, date, month } = req.query;
  const query = {};
  if (carrier) query.carrier = carrier;

  const dateFilter = buildDateFilter(date, month);
  if (dateFilter) {
    if (dateFilter.$or) {
      query.$and = query.$and || [];
      query.$and.push({ $or: dateFilter.$or });
    } else if (dateFilter.pickupDate) {
      query.pickupDate = dateFilter.pickupDate;
    }
  }

  const loads = await Load.find(query).select('status dispatchFee rate isFirstFreeLoad').lean();

  const loadsBooked = loads.length;
  const totalDispatchFee = loads.reduce((sum, load) => {
    if (load.status === 'paid') {
      return sum + (Number(load.dispatchFee) || 0);
    }
    return sum;
  }, 0);

  return success(
    res,
    200,
    {
      loadsBooked,
      totalDispatchFee: Number(totalDispatchFee.toFixed(2)),
    },
    'KPIs retrieved'
  );
});

/**
 * @route   POST /api/loads
 * @desc    Create a load
 * @access  Private/Admin
 */
export const createLoad = asyncHandler(async (req, res) => {
  const {
    carrier, dispatcher, truck, pickupLocation, deliveryLocation, pickupDate,
    deliveryDate, rate, status, commodity, weight, deadhead, trip, broker,
  } = req.body;

  if (!carrier) return error(res, 400, 'A carrier is required');

  const carrierDoc = await Carrier.findById(carrier);
  if (!carrierDoc) return error(res, 404, 'Carrier not found');

  const load = await recordLoad({
    carrierDoc,
    dispatcher,
    truck,
    status,
    details: {
      pickupLocation, deliveryLocation, pickupDate, deliveryDate, rate,
      commodity, weight, deadhead, trip, broker,
    },
  });

  await load.populate('carrier', 'companyName mcNumber');
  await load.populate('dispatcher', 'name email');

  return success(res, 201, load, 'Load created');
});

/**
 * @route   PATCH /api/loads/:id
 * @desc    Update a load (status, details, etc.)
 * @access  Private/Admin
 */
export const updateLoad = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    status, rate, pickupLocation, deliveryLocation, pickupDate,
    deliveryDate, commodity, weight, deadhead, trip, broker, dispatchFee,
  } = req.body;

  const load = await Load.findById(id);
  if (!load) return error(res, 404, 'Load not found');

  if (status !== undefined) load.status = status;
  if (rate !== undefined) load.rate = rate;
  if (pickupLocation !== undefined) load.pickupLocation = pickupLocation;
  if (deliveryLocation !== undefined) load.deliveryLocation = deliveryLocation;
  if (pickupDate !== undefined) load.pickupDate = pickupDate;
  if (deliveryDate !== undefined) load.deliveryDate = deliveryDate;
  if (commodity !== undefined) load.commodity = commodity;
  if (weight !== undefined) load.weight = weight;
  if (deadhead !== undefined) load.deadhead = deadhead;
  if (trip !== undefined) load.trip = trip;
  if (broker !== undefined) load.broker = broker;
  if (dispatchFee !== undefined) load.dispatchFee = dispatchFee;

  await load.save();
  await load.populate('carrier', 'companyName mcNumber dotNumber phone email');
  await load.populate('dispatcher', 'name email');
  await load.populate('truck', 'truckNumber equipmentType driverName driverPhone');
  await load.populate('invoice', 'documentNumber fileUrl generatedAt');

  return success(res, 200, load, 'Load updated');
});

/**
 * @route   DELETE /api/loads/:id
 * @desc    Delete a load
 * @access  Private/Admin
 */
export const deleteLoad = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const load = await Load.findByIdAndDelete(id);
  if (!load) return error(res, 404, 'Load not found');
  return success(res, 200, null, 'Load deleted');
});

export default { getLoads, getLoadKPIs, createLoad, updateLoad, deleteLoad };
