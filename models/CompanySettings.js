import mongoose from 'mongoose';

const paymentDetailSchema = new mongoose.Schema(
  {
    label: {
      type: String,
      trim: true,
      default: '',
    },
    value: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { _id: false }
);

const companySettingsSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      trim: true,
      default: '',
    },
    address: {
      type: String,
      trim: true,
      default: '',
    },
    officialEmail: {
      type: String,
      trim: true,
      default: '',
    },
    legalEntityName: {
      type: String,
      trim: true,
      default: 'DKR Trucking LLC',
    },
    website: {
      type: String,
      trim: true,
      default: 'dkrtrucking.com',
    },
    paymentMethodLabel: {
      type: String,
      trim: true,
      default: '',
    },
    paymentDetails: {
      type: [paymentDetailSchema],
      default: [],
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Helper static to get or initialize the singleton settings
companySettingsSchema.statics.getSettings = async function () {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({
      phone: '',
      address: '',
      officialEmail: '',
      legalEntityName: 'DKR Trucking LLC',
      website: 'dkrtrucking.com',
      paymentMethodLabel: '',
      paymentDetails: [],
    });
  }
  return settings;
};

const CompanySettings = mongoose.model('CompanySettings', companySettingsSchema);

export default CompanySettings;
