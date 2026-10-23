import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const BASE_URL = 'http://localhost:5003';
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret_change_me';

async function runVerification() {
  console.log('=== STARTING END-TO-END VERIFICATION ===\n');
  const results = {};

  // Connect to MongoDB to get Admin user ID for signing valid auth token
  let authToken = '';
  try {
    await mongoose.connect(MONGO_URI);
    const adminUser = await mongoose.connection.collection('users').findOne({ role: 'admin' });
    if (adminUser) {
      authToken = jwt.sign({ userId: adminUser._id }, JWT_SECRET, { expiresIn: '7d' });
      console.log('✓ Connected to MongoDB. Found Admin:', adminUser.email, '| JWT Token generated.');
    } else {
      console.warn('⚠️ No admin user found in DB.');
    }
  } catch (err) {
    console.warn('⚠️ Mongoose connection for auth token generation notice:', err.message);
  } finally {
    await mongoose.disconnect();
  }

  // 1. Test CMS FAQs
  try {
    const res = await fetch(`${BASE_URL}/api/cms/faqs?isVisible=true`);
    const data = await res.json();
    console.log('✓ FAQs CMS fetch succeeded. Status:', res.status, '| Items count:', data?.data?.length);
    results.faqs = res.ok ? 'PASS' : 'FAIL';
  } catch (err) {
    console.error('✗ FAQs CMS fetch failed:', err.message);
    results.faqs = 'FAIL';
  }

  // 2. Test CMS Testimonials
  try {
    const res = await fetch(`${BASE_URL}/api/cms/testimonials?isVisible=true`);
    const data = await res.json();
    console.log('✓ Testimonials CMS fetch succeeded. Status:', res.status, '| Items count:', data?.data?.length);
    results.testimonials = res.ok ? 'PASS' : 'FAIL';
  } catch (err) {
    console.error('✗ Testimonials CMS fetch failed:', err.message);
    results.testimonials = 'FAIL';
  }

  // 3. Test Blog API used by Website CMS and public website
  try {
    const res = await fetch(`${BASE_URL}/api/blogs`);
    const data = await res.json();
    console.log('✓ Blog list CMS fetch succeeded. Status:', res.status, '| Items count:', data?.data?.length);
    results.blog = res.ok ? 'PASS' : 'FAIL';
  } catch (err) {
    console.error('✗ Blog list CMS fetch failed:', err.message);
    results.blog = 'FAIL';
  }

  // 4. Test CMS Social Links
  try {
    const res = await fetch(`${BASE_URL}/api/cms/social_links?isVisible=true`);
    const data = await res.json();
    console.log('✓ Social Links CMS fetch succeeded. Status:', res.status, '| Items count:', data?.data?.length);
    results.socialLinks = res.ok ? 'PASS' : 'FAIL';
  } catch (err) {
    console.error('✗ Social Links CMS fetch failed:', err.message);
    results.socialLinks = 'FAIL';
  }

  // 5. Test Contact Form Submission
  try {
    const res = await fetch(`${BASE_URL}/api/inquiries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'contact',
        name: 'Verification Test User',
        email: 'testuser@dkrtrucking.test',
        phone: '(555) 123-4567',
        truckType: 'Dry Van',
        message: 'Automated end-to-end verification contact submission.',
      }),
    });
    const data = await res.json();
    console.log('✓ Contact Us submission succeeded. Status:', res.status, '| Inquiry ID:', data?.data?._id || 'OK');
    results.contactForm = res.ok ? 'PASS' : 'FAIL';
  } catch (err) {
    console.error('✗ Contact Us submission failed:', err.message);
    results.contactForm = 'FAIL';
  }

  // Create valid PNG File objects for Cloudinary upload verification
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const pngBuffer = Buffer.from(pngBase64, 'base64');
  const file1 = new File([pngBuffer], 'mc_authority_test.png', { type: 'image/png' });
  const file2 = new File([pngBuffer], 'coi_insurance_test.png', { type: 'image/png' });
  const file3 = new File([pngBuffer], 'cdl_license_test.png', { type: 'image/png' });

  // 6. Test Carrier Setup Form WITH Document Upload
  let testCarrierId = null;
  let testCarrierDocId = null;
  try {
    const form = new FormData();
    form.append('companyName', 'E2E Test Logistics LLC');
    form.append('name', 'John Carrier Tester');
    form.append('contactName', 'John Carrier Tester');
    form.append('email', 'carrier@e2etest.com');
    form.append('phone', '(555) 987-6543');
    form.append('truckType', 'Dry Van, Flatbed');
    form.append('authorityAge', 'over 6 months');
    form.append('mcNumber', `MC-${Math.floor(100000 + Math.random() * 900000)}`);
    form.append('dotNumber', `DOT-${Math.floor(1000000 + Math.random() * 9000000)}`);

    // Attach documents
    form.append('mcLetter', file1);
    form.append('coi', file2);

    const res = await fetch(`${BASE_URL}/api/carriers/public-setup`, {
      method: 'POST',
      body: form,
    });
    const data = await res.json();
    const carrier = data?.data;
    testCarrierId = carrier?._id;
    testCarrierDocId = carrier?.documents?.[0]?._id;

    console.log('✓ Carrier Setup submission with document upload succeeded. Status:', res.status);
    console.log('  Carrier ID:', testCarrierId);
    console.log('  Documents uploaded count:', carrier?.documents?.length);
    console.log('  Sample Document Cloudinary URL:', carrier?.documents?.[0]?.cloudinaryUrl);
    results.carrierSetupUpload = res.ok && carrier?.documents?.length > 0 ? 'PASS' : 'FAIL';
  } catch (err) {
    console.error('✗ Carrier Setup submission failed:', err.message);
    results.carrierSetupUpload = 'FAIL';
  }

  // Verify Carrier Document Download Link (with auth headers)
  if (testCarrierId && testCarrierDocId) {
    try {
      const headers = {};
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
        headers['Cookie'] = `token=${authToken}`;
      }
      const url = `${BASE_URL}/api/carriers/${testCarrierId}/documents/${testCarrierDocId}/download${authToken ? `?token=${authToken}` : ''}`;
      const res = await fetch(url, { headers });
      const buffer = await res.arrayBuffer();
      console.log('✓ Carrier Document download endpoint verified. Status:', res.status, '| Download byte size:', buffer.byteLength);
      results.carrierDocumentDownload = res.ok && buffer.byteLength > 0 ? 'PASS' : 'FAIL';
    } catch (err) {
      console.error('✗ Carrier Document download failed:', err.message);
      results.carrierDocumentDownload = 'FAIL';
    }
  } else {
    results.carrierDocumentDownload = 'SKIP';
  }

  // 7. Test Driver Application Form WITH Document Upload
  let testDriverId = null;
  let testDriverDocId = null;
  try {
    const form = new FormData();
    form.append('name', 'Dave Driver Tester');
    form.append('phone', '(555) 444-3333');
    form.append('email', 'driver@e2etest.com');
    form.append('homeState', 'TX');
    form.append('yearsExperience', '5');
    form.append('equipmentExperience', JSON.stringify(['Flatbed', 'Dry Van']));
    form.append('manualTransmission', 'true');
    form.append('endorsements', JSON.stringify(['TWIC', 'Hazmat']));
    form.append('currentEmployer', 'E2E Testing Corp');
    form.append('earliestAvailableDate', '2026-09-01');
    form.append('payExpectation', '$2,000/wk');
    form.append('source', 'Facebook Group');
    form.append('status', 'New');
    form.append('smsConsent', 'true');
    form.append('screeningAnswers', JSON.stringify({ cdlYearsExperience: '5 years', flatbedExperience: '3 years' }));

    // Attach documents
    form.append('documents', file3);
    form.append('fileTypes', JSON.stringify(['CDL License']));

    const res = await fetch(`${BASE_URL}/api/drivers`, {
      method: 'POST',
      body: form,
    });
    const data = await res.json();
    const driver = data?.data;
    testDriverId = driver?._id;
    testDriverDocId = driver?.documents?.[0]?._id;

    console.log('✓ Driver Application submission with document upload succeeded. Status:', res.status);
    console.log('  Driver ID:', testDriverId);
    console.log('  Documents uploaded count:', driver?.documents?.length);
    console.log('  Sample Document Cloudinary URL:', driver?.documents?.[0]?.cloudinaryUrl);
    results.driverApplicationUpload = res.ok && driver?.documents?.length > 0 ? 'PASS' : 'FAIL';
  } catch (err) {
    console.error('✗ Driver Application submission failed:', err.message);
    results.driverApplicationUpload = 'FAIL';
  }

  // Verify Driver Document Download Link (with auth headers)
  if (testDriverId && testDriverDocId) {
    try {
      const headers = {};
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
        headers['Cookie'] = `token=${authToken}`;
      }
      const url = `${BASE_URL}/api/drivers/${testDriverId}/documents/${testDriverDocId}/download${authToken ? `?token=${authToken}` : ''}`;
      const res = await fetch(url, { headers });
      const buffer = await res.arrayBuffer();
      console.log('✓ Driver Document download endpoint verified. Status:', res.status, '| Download byte size:', buffer.byteLength);
      results.driverDocumentDownload = res.ok && buffer.byteLength > 0 ? 'PASS' : 'FAIL';
    } catch (err) {
      console.error('✗ Driver Document download failed:', err.message);
      results.driverDocumentDownload = 'FAIL';
    }
  } else {
    results.driverDocumentDownload = 'SKIP';
  }

  console.log('\n=== VERIFICATION RESULTS SUMMARY ===');
  console.table(results);
}

runVerification();
