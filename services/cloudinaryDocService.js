import cloudinary from '../config/cloudinary.js';
import https from 'https';
import http from 'http';
import path from 'path';

/**
 * Upload a document buffer to Cloudinary
 * Handles PDFs, Word docs, images, and other raw document types.
 */
export const uploadDocToCloudinary = (fileBuffer, originalName, folder = 'dkr/documents') => {
  return new Promise((resolve, reject) => {
    if (!fileBuffer || !Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
      return reject(new Error('Empty file buffer'));
    }

    const sanitizedBase = path.parse(originalName).name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const publicId = `${Date.now()}_${sanitizedBase}`;
    const ext = path.extname(originalName).toLowerCase().replace('.', '') || 'bin';

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'auto',
        public_id: publicId,
      },
      (error, result) => {
        if (error) {
          console.error('Cloudinary document upload error:', error);
          return reject(error);
        }

        resolve({
          originalFileName: originalName,
          cloudinaryUrl: result.secure_url,
          cloudinaryPublicId: result.public_id,
          resourceType: result.resource_type || 'raw',
          fileType: ext,
        });
      }
    );

    uploadStream.end(fileBuffer);
  });
};

/**
 * Delete a document asset from Cloudinary by publicId
 */
export const deleteDocFromCloudinary = async (publicId, resourceType = 'raw') => {
  if (!publicId) return true;

  try {
    // Attempt deletion with provided or default resource_type
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
      invalidate: true,
    });

    if (result.result === 'ok') return true;

    // Fallbacks if specified resource_type did not match (e.g. image vs raw vs auto)
    const fallbackTypes = ['image', 'raw', 'video'].filter((t) => t !== resourceType);
    for (const type of fallbackTypes) {
      const fbResult = await cloudinary.uploader.destroy(publicId, {
        resource_type: type,
        invalidate: true,
      });
      if (fbResult.result === 'ok') return true;
    }

    return false;
  } catch (err) {
    console.warn(`Failed to delete asset ${publicId} from Cloudinary:`, err.message);
    return false;
  }
};

/**
 * Stream a document directly from Cloudinary to Express response,
 * enforcing forced download with original filename restored via Content-Disposition header.
 */
export const streamDocDownload = (res, cloudinaryUrl, originalFileName, redirectDepth = 0) => {
  const MAX_REDIRECTS = 5;

  if (!cloudinaryUrl) {
    if (!res.headersSent) {
      return res.status(404).json({ success: false, message: 'Document URL not found.' });
    }
    return res.destroy(new Error('Document URL not found.'));
  }

  if (redirectDepth > MAX_REDIRECTS) {
    const err = new Error('Cloudinary redirect limit exceeded');
    console.error('Cloudinary redirect limit exceeded for download:', cloudinaryUrl);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, message: 'Failed to download file stream.' });
    }
    return res.destroy(err);
  }

  const safeFileName = (originalFileName || 'downloaded_document').replace(/"/g, '');
  const encodedName = encodeURIComponent(safeFileName);

  try {
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeFileName}"; filename*=UTF-8''${encodedName}`
    );
  } catch (err) {
    console.error('Error setting Cloudinary download headers:', err);
    return res.destroy(err);
  }

  const client = cloudinaryUrl.startsWith('https') ? https : http;

  try {
    const request = client.get(cloudinaryUrl, (cloudinaryStream) => {
      try {
        const statusCode = cloudinaryStream.statusCode || 0;

        // Follow redirect if Cloudinary returns a temporary/redirect response.
        if (statusCode >= 300 && statusCode < 400 && cloudinaryStream.headers.location) {
          if (redirectDepth >= MAX_REDIRECTS) {
            const err = new Error('Cloudinary redirect limit exceeded');
            console.error('Cloudinary redirect limit exceeded for download:', cloudinaryUrl);
            if (!res.headersSent) {
              return res.status(500).json({ success: false, message: 'Failed to download file stream.' });
            }
            return res.destroy(err);
          }

          return streamDocDownload(res, cloudinaryStream.headers.location, originalFileName, redirectDepth + 1);
        }

        if (statusCode !== 200) {
          if (!res.headersSent) {
            return res.status(statusCode || 500).json({
              success: false,
              message: `Failed to fetch file from storage (HTTP ${statusCode}).`,
            });
          }
          return res.destroy(new Error(`Cloudinary stream failed with status ${statusCode}`));
        }

        if (cloudinaryStream.headers['content-type']) {
          res.setHeader('Content-Type', cloudinaryStream.headers['content-type']);
        }
        if (cloudinaryStream.headers['content-length']) {
          res.setHeader('Content-Length', cloudinaryStream.headers['content-length']);
        }

        cloudinaryStream.on('error', (streamErr) => {
          console.error('Cloudinary document stream error:', streamErr);
          if (!res.headersSent) {
            res.status(500).json({ success: false, message: 'Failed to download file stream.' });
          }
          res.destroy(streamErr);
        });

        cloudinaryStream.pipe(res);
      } catch (err) {
        console.error('Error handling Cloudinary document response:', err);
        if (!res.headersSent) {
          res.status(500).json({ success: false, message: 'Failed to download file stream.' });
        }
        res.destroy(err);
      }
    });

    request.on('error', (err) => {
      console.error('Error streaming document download from Cloudinary:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: 'Failed to download file stream.' });
      }
      res.destroy(err);
    });
  } catch (err) {
    console.error('Unexpected Cloudinary download failure:', err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Failed to download file stream.' });
    }
    res.destroy(err);
  }
};
