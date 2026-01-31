import { Router, Request, Response } from 'express';
import { container } from 'tsyringe';
import multer from 'multer';
import { createReadStream, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { FileImportService, FileFormat, ImportOptions } from '../services/fileImportService.js';

const router = Router();

// Configure multer for file uploads
// Use disk storage for large files to avoid memory issues
const uploadDir = join(process.cwd(), 'uploads');
if (!existsSync(uploadDir)) {
  mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 * 1024, // 5GB limit for large files
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.json', '.xml'];
    const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));

    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${ext} not supported. Allowed: ${allowedTypes.join(', ')}`));
    }
  },
});

/**
 * POST /api/import/file
 * Upload and import a file into the database
 *
 * Form data:
 * - file: The file to import
 * - tableName: Target table name (required)
 * - format: File format (json, xml, google-takeout, chat-transcript, auto)
 * - batchSize: Number of records per batch (default: 500)
 * - rootElement: For XML - which element contains records
 * - idField: Field path to use as record ID
 */
router.post('/file', upload.single('file'), async (req: Request, res: Response) => {
  const startTime = Date.now();

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const { tableName, format, batchSize, rootElement, idField } = req.body;

  if (!tableName) {
    // Clean up uploaded file
    try {
      unlinkSync(req.file.path);
    } catch {}
    return res.status(400).json({ error: 'tableName is required' });
  }

  console.log(`[IMPORT API] Starting import of ${req.file.originalname}`);
  console.log(`[IMPORT API] File size: ${(req.file.size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`[IMPORT API] Target table: ${tableName}, Format: ${format || 'auto'}`);

  try {
    const importService = container.resolve(FileImportService);

    const options: ImportOptions = {
      tableName,
      format: format as FileFormat || 'auto',
      batchSize: batchSize ? parseInt(batchSize) : 500,
      rootElement,
      idField,
    };

    const result = await importService.importFile(req.file.path, options);

    // Clean up uploaded file after processing
    try {
      unlinkSync(req.file.path);
      console.log(`[IMPORT API] Cleaned up uploaded file`);
    } catch (cleanupError) {
      console.warn(`[IMPORT API] Failed to clean up file: ${cleanupError}`);
    }

    res.json({
      ...result,
      originalFilename: req.file.originalname,
      fileSize: req.file.size,
      totalDuration: Date.now() - startTime,
    });
  } catch (error: any) {
    console.error(`[IMPORT API] Error:`, error);

    // Clean up uploaded file on error
    try {
      unlinkSync(req.file.path);
    } catch {}

    res.status(500).json({
      error: 'Import failed',
      message: error.message,
      details: error.stack,
    });
  }
});

/**
 * POST /api/import/path
 * Import a file from a local path (for server-side files)
 *
 * Body:
 * - filePath: Path to the file on the server
 * - tableName: Target table name (required)
 * - format: File format (json, xml, google-takeout, chat-transcript, auto)
 * - batchSize: Number of records per batch (default: 500)
 * - rootElement: For XML - which element contains records
 * - idField: Field path to use as record ID
 */
router.post('/path', async (req: Request, res: Response) => {
  const { filePath, tableName, format, batchSize, rootElement, idField } = req.body;

  if (!filePath) {
    return res.status(400).json({ error: 'filePath is required' });
  }

  if (!tableName) {
    return res.status(400).json({ error: 'tableName is required' });
  }

  if (!existsSync(filePath)) {
    return res.status(404).json({ error: `File not found: ${filePath}` });
  }

  console.log(`[IMPORT API] Starting import from path: ${filePath}`);
  console.log(`[IMPORT API] Target table: ${tableName}, Format: ${format || 'auto'}`);

  try {
    const importService = container.resolve(FileImportService);

    const options: ImportOptions = {
      tableName,
      format: format as FileFormat || 'auto',
      batchSize: batchSize || 500,
      rootElement,
      idField,
    };

    const result = await importService.importFile(filePath, options);

    res.json({
      ...result,
      filePath,
    });
  } catch (error: any) {
    console.error(`[IMPORT API] Error:`, error);
    res.status(500).json({
      error: 'Import failed',
      message: error.message,
    });
  }
});

/**
 * GET /api/import/formats
 * Get list of supported file formats
 */
router.get('/formats', (req: Request, res: Response) => {
  const importService = container.resolve(FileImportService);
  const formats = importService.getSupportedFormats();

  res.json({
    formats,
    maxFileSize: '5GB',
    streamingSupported: true,
  });
});

/**
 * POST /api/import/analyze
 * Analyze a file without importing (preview the structure)
 *
 * Form data:
 * - file: The file to analyze
 * - format: File format (optional, will auto-detect)
 * - sampleSize: Number of records to analyze (default: 10)
 */
router.post('/analyze', upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const { format, sampleSize } = req.body;
  const maxSamples = Math.min(parseInt(sampleSize) || 10, 100);

  console.log(`[IMPORT API] Analyzing file: ${req.file.originalname}`);

  try {
    const importService = container.resolve(FileImportService);

    // Create a temporary table for analysis
    const tempTable = `_temp_analysis_${Date.now()}`;

    const options: ImportOptions = {
      tableName: tempTable,
      format: format as FileFormat || 'auto',
      batchSize: maxSamples,
    };

    // Import just a sample
    const result = await importService.importFile(req.file.path, {
      ...options,
      batchSize: maxSamples,
    });

    // Get sample records from the temp table
    const { DatabaseConnection } = await import('../database/connection.js');
    const db = container.resolve(DatabaseConnection);

    let sampleRecords: any[] = [];
    let fieldAnalysis: any[] = [];

    try {
      const records = await db.rawQuery<any>(
        `SELECT id, content FROM \`${tempTable}_toprocess\` LIMIT ${maxSamples}`
      );

      sampleRecords = records.map((r: any) => ({
        id: r.id,
        content: typeof r.content === 'string' ? JSON.parse(r.content) : r.content,
      }));

      // Analyze fields from sample
      if (sampleRecords.length > 0) {
        const fieldMap = new Map<string, { types: Set<string>; samples: any[] }>();

        for (const record of sampleRecords) {
          analyzeObjectFields(record.content, '', fieldMap);
        }

        fieldAnalysis = Array.from(fieldMap.entries()).map(([path, data]) => ({
          path,
          types: Array.from(data.types),
          samples: data.samples.slice(0, 3),
        }));
      }

      // Clean up temp tables
      await db.rawQuery(`DROP TABLE IF EXISTS \`${tempTable}_toprocess\``);
      await db.rawQuery(`DROP TABLE IF EXISTS \`${tempTable}\``);
    } catch (dbError) {
      console.warn(`[IMPORT API] Analysis cleanup warning:`, dbError);
    }

    // Clean up uploaded file
    try {
      unlinkSync(req.file.path);
    } catch {}

    res.json({
      originalFilename: req.file.originalname,
      fileSize: req.file.size,
      detectedFormat: result.format,
      recordsAnalyzed: sampleRecords.length,
      sampleRecords: sampleRecords.slice(0, 5),
      fields: fieldAnalysis,
      estimatedTotalRecords: result.recordsProcessed,
    });
  } catch (error: any) {
    console.error(`[IMPORT API] Analysis error:`, error);

    // Clean up
    try {
      unlinkSync(req.file.path);
    } catch {}

    res.status(500).json({
      error: 'Analysis failed',
      message: error.message,
    });
  }
});

// Helper function to analyze object fields
function analyzeObjectFields(
  obj: any,
  prefix: string,
  fieldMap: Map<string, { types: Set<string>; samples: any[] }>,
  visited = new WeakSet(),
  depth = 0
): void {
  if (obj === null || obj === undefined || depth > 10) return;

  if (Array.isArray(obj)) {
    if (obj.length > 0 && typeof obj[0] === 'object') {
      analyzeObjectFields(obj[0], prefix, fieldMap, visited, depth + 1);
    }
    return;
  }

  if (typeof obj === 'object') {
    if (visited.has(obj)) return;
    visited.add(obj);

    for (const key in obj) {
      const path = prefix ? `${prefix}.${key}` : key;
      const value = obj[key];

      if (!fieldMap.has(path)) {
        fieldMap.set(path, { types: new Set(), samples: [] });
      }

      const field = fieldMap.get(path)!;
      const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
      field.types.add(type);

      if (field.samples.length < 3 && value !== null && value !== undefined) {
        if (typeof value !== 'object') {
          field.samples.push(value);
        }
      }

      if (typeof value === 'object' && value !== null) {
        analyzeObjectFields(value, path, fieldMap, visited, depth + 1);
      }
    }
  }
}

export default router;
