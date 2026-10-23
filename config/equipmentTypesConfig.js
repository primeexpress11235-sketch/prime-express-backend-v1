/**
 * Single source of truth configuration for the 12 Canonical Equipment Types
 * across DKR Trucking platform.
 */

export const STANDARD_EQUIPMENT = [
  {
    id: 'reefer',
    slug: 'reefer',
    name: 'Reefer',
    category: 'Standard',
    baseType: 'Reefer',
    attributes: [],
  },
  {
    id: 'dry-van',
    slug: 'dry-van',
    name: 'Dry Van',
    category: 'Standard',
    baseType: 'Dry Van',
    attributes: [
      { key: 'doorType', label: 'Door Type', options: ['Swing', 'Roll-up'], type: 'select' },
      { key: 'liftGate', label: 'Lift Gate', options: ['Yes', 'No'], type: 'select' },
    ],
  },
  {
    id: 'flatbed',
    slug: 'flatbed',
    name: 'Flatbed',
    category: 'Standard',
    baseType: 'FlatBed',
    attributes: [
      { key: 'trailerLength', label: 'Length', options: ['48ft', '53ft'], type: 'select' },
    ],
  },
  {
    id: 'step-deck',
    slug: 'step-deck',
    name: 'Step Deck',
    category: 'Standard',
    baseType: 'Step Deck',
    attributes: [
      {
        key: 'stepDeckSubType',
        label: 'Sub-Type',
        options: ['Extendable', 'With Loading Ramps', 'Over-Dimension Loads'],
        type: 'select',
      },
    ],
  },
  {
    id: 'power-only',
    slug: 'power-only',
    name: 'Power Only',
    category: 'Standard',
    baseType: 'Power Only',
    attributes: [],
  },
  {
    id: 'hotshot',
    slug: 'hot-shot',
    name: 'Hotshot',
    category: 'Standard',
    baseType: 'HotShot',
    attributes: [
      { key: 'trailerConfig', label: 'Trailer Configuration', options: ['Gooseneck', 'Bumper Pull'], type: 'select' },
      { key: 'trailerSize', label: 'Trailer Size', options: ['20ft', '25ft', '30ft', '35ft', '40ft'], type: 'select' },
    ],
  },
  {
    id: 'box-truck',
    slug: 'box-truck',
    name: 'Box Truck',
    category: 'Standard',
    baseType: 'Box Truck',
    attributes: [],
  },
];

export const SPECIALIZED_EQUIPMENT = [
  {
    id: 'lowboy',
    slug: 'lowboy',
    name: 'Lowboy',
    category: 'Specialized',
    baseType: 'lowboy',
    defaultValues: { neckType: 'fixed' },
    attributes: [
      { key: 'neckType', label: 'Neck Type', options: ['fixed'], type: 'select', hidden: true },
    ],
  },
  {
    id: 'rgn',
    slug: 'rgn',
    name: 'RGN',
    category: 'Specialized',
    baseType: 'lowboy',
    defaultValues: { neckType: 'removable' },
    attributes: [
      { key: 'neckType', label: 'Neck Type', options: ['removable'], type: 'select', hidden: true },
    ],
  },
  {
    id: 'conestoga',
    slug: 'conestoga',
    name: 'Conestoga',
    category: 'Specialized',
    baseType: 'Conestoga',
    attributes: [],
  },
  {
    id: 'tanker',
    slug: 'tanker',
    name: 'Tanker',
    category: 'Specialized',
    baseType: 'Tanker',
    attributes: [
      { key: 'cargoType', label: 'Cargo Type', options: ['Food Grade', 'Liquid', 'Bulk'], type: 'select' },
    ],
  },
  {
    id: 'auto-car-hauler',
    slug: 'auto-car-hauler',
    name: 'Auto/Car Hauler',
    category: 'Specialized',
    baseType: 'Auto/Car Hauler',
    attributes: [],
  },
];

export const ALL_EQUIPMENT_TYPES = [...STANDARD_EQUIPMENT, ...SPECIALIZED_EQUIPMENT];

export const getEquipmentConfig = (nameOrSlugOrBase) => {
  if (!nameOrSlugOrBase) return null;
  const target = String(nameOrSlugOrBase).toLowerCase().trim();
  return (
    ALL_EQUIPMENT_TYPES.find(
      (eq) =>
        eq.id === target ||
        eq.slug === target ||
        eq.name.toLowerCase() === target ||
        eq.baseType.toLowerCase() === target
    ) || null
  );
};
