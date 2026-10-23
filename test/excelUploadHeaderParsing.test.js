import test from 'node:test';
import assert from 'node:assert/strict';
import * as xlsx from 'xlsx';

import {
  buildLeadInsertDocument,
  normalizeHeaderKey,
  resolveLeadRowValues,
} from '../controllers/leadController.js';

test('header names are normalized across casing and spacing', () => {
  assert.equal(normalizeHeaderKey('MC Number'), 'mcnumber');
  assert.equal(normalizeHeaderKey(' ZIP '), 'zip');
  assert.equal(normalizeHeaderKey('Power Units'), 'powerunits');
  assert.equal(normalizeHeaderKey('NBR_POWER_UNIT'), 'nbrpowerunit');
  assert.equal(normalizeHeaderKey('MC/FF Number'), 'mcffnumber');
});

test('real-world spreadsheet headers with uppercase ZIP and mixed casing map cleanly', () => {
  const row = {
    'MC Number': 'MC123456',
    'DOT Number': 'DOT987654',
    'Company Name': 'Northwind Logistics',
    'Phone': '555-0101',
    'Email': 'ops@northwind.com',
    'Address': '100 Main St',
    'City': 'Dallas',
    'State': 'TX',
    ZIP: '75201',
    'Power Units': '14',
    'MC Age': '3 Years',
    'MC Status': 'Growing',
  };

  const result = resolveLeadRowValues(row);

  assert.equal(result.valid, true);
  assert.equal(result.data.mcNumber, 'MC123456');
  assert.equal(result.data.zip, '75201');
  assert.equal(result.data.powerUnits, 14);
  assert.equal(result.data.mcStatus, 'Growing');
  assert.equal(result.data.dotNumber, 'DOT987654');
  assert.equal(result.data.mcAge, '3 Years');
  assert.equal(result.data.phone, '555-0101');
  assert.equal(result.data.email, 'ops@northwind.com');
});

test('xlsx upload headers map through to the saved lead document without database writes', () => {
  const worksheet = xlsx.utils.json_to_sheet([{
    'MC/FF Number': '1650198',
    'USDOT': '3456789',
    'Legal Name': 'Apex Freight Lines',
    Phone: '555-0101',
    Email: 'ops@northwind.com',
    'NBR_POWER_UNIT': '14',
    'MC Age': '3 Years',
  }]);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, 'Leads');
  const parsedRows = xlsx.utils.sheet_to_json(
    xlsx.read(xlsx.write(workbook, { type: 'buffer' }), { type: 'buffer' }).Sheets.Leads,
    { defval: '' }
  );
  const result = resolveLeadRowValues(parsedRows[0]);
  const savedLead = buildLeadInsertDocument(result.data);

  assert.equal(savedLead.mcNumber, '1650198');
  assert.equal(savedLead.dotNumber, '3456789');
  assert.equal(savedLead.companyName, 'Apex Freight Lines');
  assert.equal(savedLead.powerUnits, 14);
  assert.equal(savedLead.mcAge, '3 Years');
  assert.equal(savedLead.phone, '555-0101');
  assert.equal(savedLead.email, 'ops@northwind.com');
  assert.equal(savedLead.mcNumberDigits, '1650198');
  assert.equal(savedLead.dotNumberDigits, '3456789');
  assert.equal(savedLead.phoneDigits, '5550101');
});

test('empty rows are rejected while company-name-only rows remain importable', () => {
  assert.equal(resolveLeadRowValues({}).valid, false);
  assert.equal(resolveLeadRowValues({ 'Company Name': 'Missing MC' }).valid, true);
});
