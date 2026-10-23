import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import cloudinary from '../config/cloudinary.js';
import Certification from '../models/Certification.js';
import logger from '../utils/logger.js';

const certificateTemplatePath = fileURLToPath(
  new URL('../assets/certificate.png', import.meta.url)
);
const certificateTemplateVersion = 5;

const fitTextSize = (text, font, preferredSize, maxWidth, minimumSize = 12) => {
  let size = preferredSize;
  while (size > minimumSize && font.widthOfTextAtSize(text, size) > maxWidth) {
    size -= 1;
  }
  return size;
};

const drawCenteredText = (page, text, font, preferredSize, centerX, baselineY, maxWidth) => {
  const size = fitTextSize(text, font, preferredSize, maxWidth);
  const textWidth = font.widthOfTextAtSize(text, size);

  page.drawText(text, {
    x: centerX - textWidth / 2,
    y: baselineY,
    size,
    font,
    color: rgb(0, 0, 0),
  });
};

export const createSalesAgentCertificatePdf = async ({
  agentName,
  completionDate,
  certificateId,
}) => {
  const templateBytes = await readFile(certificateTemplatePath);
  const pdfDoc = await PDFDocument.create();
  const template = await pdfDoc.embedPng(templateBytes);
  const { width, height } = template.scale(1);
  const page = pdfDoc.addPage([width, height]);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  page.drawImage(template, { x: 0, y: 0, width, height });

  drawCenteredText(page, agentName, fontBold, 46, width / 2, height - 650, 900);
  drawCenteredText(page, completionDate, fontRegular, 20, 330, height - 860, 250);
  drawCenteredText(page, certificateId, fontRegular, 18, 1140, height - 860, 260);

  return pdfDoc.save();
};

/**
 * Generates a unique Certificate ID format: DKR-SA-{YYYY}-{4-digit sequential number}
 */
export const generateNextCertificateId = async () => {
  const currentYear = new Date().getFullYear();
  const count = await Certification.countDocuments();
  const sequential = String(count + 1).padStart(4, '0');
  return `DKR-SA-${currentYear}-${sequential}`;
};

/**
 * Creates a PDF certificate for a Sales Agent using pdf-lib, uploads it to Cloudinary,
 * and saves the Certification record in MongoDB.
 */
export const generateSalesAgentCertificate = async (user, course = null) => {
  try {
    const courseId = course?._id?.toString() || 'sales-agent-v1';
    const existingCert = await Certification.findOne({ agentId: user._id, courseId });
    if (existingCert?.certificateTemplateVersion === certificateTemplateVersion) {
      return existingCert;
    }

    const certificateId = existingCert?.certificateId || (await generateNextCertificateId());
    const completionDateStr = new Date(existingCert?.completedAt || Date.now()).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const pdfBytes = await createSalesAgentCertificatePdf({
      agentName: user.name || 'Sales Agent',
      completionDate: completionDateStr,
      certificateId,
    });
    const pdfBase64 = Buffer.from(pdfBytes).toString('base64');
    const dataUri = `data:application/pdf;base64,${pdfBase64}`;

    // Upload to Cloudinary
    const uploadResult = await cloudinary.uploader.upload(dataUri, {
      folder: 'dkr/certificates',
      resource_type: 'auto',
      public_id: `${certificateId}-${user._id}`,
      overwrite: true,
      invalidate: true,
    });

    const certificateUrl = uploadResult.secure_url;

    const certification = existingCert || new Certification({
      agentId: user._id,
      courseId,
      completedAt: new Date(),
      certificateId,
    });
    certification.certificateUrl = certificateUrl;
    certification.certificateTemplateVersion = certificateTemplateVersion;
    await certification.save();

    logger?.info?.(`Certificate generated successfully for user ${user._id}: ${certificateId}`);
    return certification;
  } catch (err) {
    logger?.error?.('Error generating sales agent certificate:', err);
    throw err;
  }
};
