import { HttpStatus } from '@nestjs/common';
import type { SupportedDocumentMimeType } from '@cka/config';
import { ApiError } from '../common/api-error.js';

export const FILENAME_MAX_LENGTH = 255;

const EXTENSIONS: Record<string, SupportedDocumentMimeType> = {
  '.pdf': 'application/pdf',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
};

const unsupported = (): ApiError =>
  new ApiError(
    HttpStatus.BAD_REQUEST,
    'DOCUMENT_UNSUPPORTED_TYPE',
    'This file type is not supported. Upload a PDF, DOCX or TXT file.',
  );

/**
 * Display-only filename: strips any path, control and invisible formatting
 * characters (e.g. right-to-left overrides), and bounds the length.
 */
export function sanitizeFilename(original: string): string {
  const base = original.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .trim();
  if (cleaned.length <= FILENAME_MAX_LENGTH) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  const extension = dot > 0 ? cleaned.slice(dot) : '';
  return cleaned.slice(0, FILENAME_MAX_LENGTH - extension.length) + extension;
}

/**
 * Determines the document type from the extension allow-list, then requires the
 * declared MIME type and the file's content signature to agree with it.
 */
export function resolveDocumentType(
  filename: string,
  declaredMimeType: string,
  content: Buffer,
  allowed: readonly SupportedDocumentMimeType[],
): SupportedDocumentMimeType {
  const dot = filename.lastIndexOf('.');
  const mimeType =
    dot > 0 ? EXTENSIONS[filename.slice(dot).toLowerCase()] : undefined;
  if (!mimeType || !allowed.includes(mimeType)) throw unsupported();

  const declared = declaredMimeType.split(';')[0]!.trim().toLowerCase();
  if (declared !== mimeType && declared !== 'application/octet-stream') {
    throw unsupported();
  }
  if (!matchesSignature(mimeType, content)) throw unsupported();
  return mimeType;
}

function matchesSignature(
  mimeType: SupportedDocumentMimeType,
  content: Buffer,
): boolean {
  switch (mimeType) {
    case 'application/pdf':
      return content.subarray(0, 5).toString('latin1') === '%PDF-';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      // ZIP container that includes the main Word part.
      return (
        content.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) &&
        content.includes('word/document.xml')
      );
    case 'text/plain':
      return !content.includes(0) && isValidUtf8(content);
  }
}

function isValidUtf8(content: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(content);
    return true;
  } catch {
    return false;
  }
}

export function assertNotEmpty(size: number): void {
  if (size === 0) {
    throw new ApiError(
      HttpStatus.BAD_REQUEST,
      'DOCUMENT_EMPTY',
      'The uploaded file is empty.',
    );
  }
}
