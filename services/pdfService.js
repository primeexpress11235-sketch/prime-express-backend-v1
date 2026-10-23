import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import handlebars from 'handlebars';
import puppeteer from 'puppeteer';
import { uploadDocToCloudinary } from './cloudinaryDocService.js';
import Document from '../models/Document.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In-memory cache for company logo base64
let cachedLogoBase64 = null;

/**
 * Read /backend/assets/logo.png once and cache base64 string in memory
 */
export const getLogoBase64 = () => {
  if (cachedLogoBase64) {
    return cachedLogoBase64;
  }

  const primaryPath = path.resolve(__dirname, '../assets/logo.png');

  if (fs.existsSync(primaryPath)) {
    try {
      const fileBuffer = fs.readFileSync(primaryPath);
      cachedLogoBase64 = fileBuffer.toString('base64');
    } catch (err) {
      console.error('[pdfService] Error reading logo asset:', err);
      cachedLogoBase64 = '';
    }
  } else {
    console.warn('[pdfService] Logo asset not found at', primaryPath);
    cachedLogoBase64 = '';
  }

  return cachedLogoBase64;
};

/**
 * Find Chromium executable path if available in environment or standard Linux/Nixpacks locations
 */
const getChromiumExecutablePath = () => {
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  const possiblePaths = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return undefined;
};

/**
 * Generate a PDF Buffer from a named Handlebars template and data object
 * @param {string} templateName - Name of template without .html (e.g. 'invoice-template')
 * @param {object} data - Data object passed into template
 * @returns {Promise<Buffer>} - Generated PDF buffer
 */
export const generatePdfFromTemplate = async (templateName, data = {}) => {
  const cleanName = templateName.endsWith('.html') ? templateName : `${templateName}.html`;
  const templatePath = path.resolve(__dirname, '../templates', cleanName);

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found: ${templatePath}`);
  }

  const templateHtml = fs.readFileSync(templatePath, 'utf8');

  // Inject cached logo base64 if not already present
  const mergedData = {
    ...data,
    logoBase64: data.logoBase64 || getLogoBase64(),
  };

  // Compile with Handlebars
  const compiled = handlebars.compile(templateHtml);
  const renderedHtml = compiled(mergedData);

  const launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-first-run',
    '--no-zygote',
  ];

  const launchOptions = {
    headless: 'new',
    args: launchArgs,
  };

  const execPath = getChromiumExecutablePath();
  if (execPath) {
    launchOptions.executablePath = execPath;
  }

  // Launch Puppeteer
  const browser = await puppeteer.launch(launchOptions);

  try {
    const page = await browser.newPage();
    await page.setContent(renderedHtml, {
      waitUntil: 'networkidle0',
    });

    const pdfUint8Array = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: {
        top: '0px',
        right: '0px',
        bottom: '0px',
        left: '0px',
      },
    });

    return Buffer.from(pdfUint8Array);
  } finally {
    await browser.close();
  }
};

/**
 * Shared workflow:
 * 1. Generate PDF buffer using generatePdfFromTemplate
 * 2. Upload buffer to Cloudinary
 * 3. Create Document collection record in MongoDB
 */
export const generateAndSaveDocument = async ({
  type,
  templateName,
  data,
  documentNumber,
  fileName,
  relatedCarrierMC = null,
  relatedAgentId = null,
  generatedBy = null,
  metadata = {},
}) => {
  const pdfBuffer = await generatePdfFromTemplate(templateName, data);

  const safeFileName = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;
  const uploadResult = await uploadDocToCloudinary(pdfBuffer, safeFileName, 'dkr/documents');

  const docRecord = new Document({
    type,
    relatedCarrierMC: relatedCarrierMC || null,
    relatedAgentId: relatedAgentId || null,
    fileUrl: uploadResult.cloudinaryUrl,
    fileName: safeFileName,
    documentNumber,
    generatedAt: new Date(),
    generatedBy: generatedBy || null,
    metadata: {
      ...metadata,
      cloudinaryPublicId: uploadResult.cloudinaryPublicId,
      resourceType: uploadResult.resourceType || 'raw',
    },
    status: 'generated',
  });

  await docRecord.save();
  return docRecord;
};

export default {
  getLogoBase64,
  generatePdfFromTemplate,
  generateAndSaveDocument,
};
