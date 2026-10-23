import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Carrier from './models/Carrier.js';
import Truck from './models/Truck.js';

dotenv.config();

const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;

async function checkIntegrity() {
  if (!mongoUri) {
    console.log('No MONGO_URI found in environment.');
    process.exit(0);
  }

  try {
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');

    const carriers = await Carrier.find({});
    console.log(`Total carriers in database: ${carriers.length}`);

    let missingTrucksCount = 0;
    const affectedCarriers = [];

    for (const c of carriers) {
      const truckCount = await Truck.countDocuments({ carrier: c._id });
      if (truckCount === 0 && (c.truckType || c.numberOfTrucks > 0)) {
        missingTrucksCount++;
        affectedCarriers.push({
          id: c._id,
          companyName: c.companyName,
          truckType: c.truckType,
          numberOfTrucks: c.numberOfTrucks,
          dateAdded: c.createdAt || c.dateAdded,
        });
      }
    }

    console.log('\n--- DATA INTEGRITY CHECK REPORT ---');
    console.log(`Carriers with truckType/numberOfTrucks but ZERO Truck documents: ${missingTrucksCount}`);
    console.log('Affected Carriers:', JSON.stringify(affectedCarriers, null, 2));

    await mongoose.disconnect();
  } catch (err) {
    console.error('Data integrity check failed:', err.message);
  }
}

checkIntegrity();
