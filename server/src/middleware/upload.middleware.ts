import type { Request } from 'express';
import multer from 'multer';
import type { ScanType } from '@prisma/client';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_MODEL_MIME_TYPES,
  MAX_IMAGE_FILE_BYTES,
  MAX_JOB_IMAGES,
  MIN_JOB_IMAGES,
} from '../config/constants';
import { imageLimitsForScanType, MAX_SCAN_UPLOAD_FILES } from '../config/scanImageLimits';
import { AppError } from '../utils/AppError';
import { jobUploadError, jobUploadLog } from '../utils/jobUploadLog';

const storage = multer.memoryStorage();

const imageFileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.mimetype as (typeof ALLOWED_IMAGE_MIME_TYPES)[number])) {
    cb(
      new AppError(
        'UNSUPPORTED_MEDIA_TYPE',
        `Unsupported image type "${file.mimetype}". Allowed: ${ALLOWED_IMAGE_MIME_TYPES.join(', ')}.`,
        415,
      ),
    );
    return;
  }
  cb(null, true);
};

const upload = multer({
  storage,
  limits: {
    files: MAX_JOB_IMAGES,
    fileSize: MAX_IMAGE_FILE_BYTES,
  },
  fileFilter: imageFileFilter,
});

export const patientImagesUpload = upload.array('images', MAX_JOB_IMAGES);

const scanBatchUpload = multer({
  storage,
  limits: {
    files: MAX_SCAN_UPLOAD_FILES,
    fileSize: MAX_IMAGE_FILE_BYTES,
  },
  fileFilter: imageFileFilter,
});

export const scanImagesUpload = scanBatchUpload.array('images', MAX_SCAN_UPLOAD_FILES);

const modelUpload = multer({
  storage,
  limits: {
    files: 1,
    fileSize: 200 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const extension = file.originalname.split('.').pop()?.toLowerCase();
    const mimeAllowed = ALLOWED_MODEL_MIME_TYPES.includes(
      file.mimetype as (typeof ALLOWED_MODEL_MIME_TYPES)[number],
    );
    const extensionAllowed = extension === 'glb';
    if (!mimeAllowed && !extensionAllowed) {
      cb(
        new AppError(
          'UNSUPPORTED_MEDIA_TYPE',
          `Unsupported model type "${file.mimetype}". Allowed: GLB (.glb).`,
          415,
        ),
      );
      return;
    }
    cb(null, true);
  },
});

export const patientModelUpload = modelUpload.single('model');

export const testImageUpload = multer({
  storage,
  limits: {
    files: 1,
    fileSize: 2 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.mimetype as (typeof ALLOWED_IMAGE_MIME_TYPES)[number])) {
      cb(
        new AppError(
          'UNSUPPORTED_MEDIA_TYPE',
          `Unsupported image type "${file.mimetype}". Allowed: ${ALLOWED_IMAGE_MIME_TYPES.join(', ')}.`,
          415,
        ),
      );
      return;
    }
    cb(null, true);
  },
}).single('image');

export function validateUploadedModel(req: Request): Express.Multer.File {
  const file = req.file;
  if (!file?.buffer?.length) {
    throw AppError.badRequest('A GLB model file is required in the "model" field.');
  }
  return file;
}

export function validateUploadedImages(req: Request): Express.Multer.File[] {
  const files = req.files;
  if (!Array.isArray(files) || files.length === 0) {
    jobUploadError('MULTIPART', { status: 400, message: 'No files in the images field.' });
    throw AppError.badRequest('At least one image file is required in the "images" field.');
  }

  if (files.length < MIN_JOB_IMAGES || files.length > MAX_JOB_IMAGES) {
    jobUploadError('MULTIPART', {
      status: 400,
      message: `Received ${files.length} images; expected ${MIN_JOB_IMAGES}-${MAX_JOB_IMAGES}.`,
    });
    throw AppError.validation(
      `Upload between ${MIN_JOB_IMAGES} and ${MAX_JOB_IMAGES} images (received ${files.length}).`,
    );
  }

  for (const file of files) {
    if (!file.buffer?.length) {
      jobUploadError('MULTIPART', { status: 400, message: `Empty file ${file.originalname}` });
      throw AppError.badRequest(`File "${file.originalname}" is empty.`);
    }
  }

  const totalBytes = files.reduce((sum, file) => sum + file.buffer.length, 0);
  jobUploadLog('multipart parsing completed', {
    fileCount: files.length,
    totalBytes,
  });

  return files;
}

export function validateScanUploadedImages(
  files: Express.Multer.File[],
  scanType: ScanType,
): Express.Multer.File[] {
  if (!Array.isArray(files) || files.length === 0) {
    jobUploadError('MULTIPART', { status: 400, message: 'No files in the images field.' });
    throw AppError.badRequest('At least one image file is required in the "images" field.');
  }

  const { min, max } = imageLimitsForScanType(scanType);
  if (files.length < min || files.length > max) {
    jobUploadError('MULTIPART', {
      status: 400,
      message: `Received ${files.length} images for ${scanType}; expected ${min}-${max}.`,
    });
    throw AppError.validation(
      `Upload between ${min} and ${max} images for this scan type (received ${files.length}).`,
    );
  }

  for (const file of files) {
    if (!file.buffer?.length) {
      jobUploadError('MULTIPART', { status: 400, message: `Empty file ${file.originalname}` });
      throw AppError.badRequest(`File "${file.originalname}" is empty.`);
    }
  }

  const totalBytes = files.reduce((sum, file) => sum + file.buffer.length, 0);
  jobUploadLog('multipart parsing completed', {
    fileCount: files.length,
    totalBytes,
    scanType,
  });

  return files;
}
