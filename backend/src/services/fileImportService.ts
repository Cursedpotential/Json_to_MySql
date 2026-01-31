import { injectable, inject } from 'tsyringe';
import { DatabaseConnection } from '../database/connection.js';
import { createReadStream, statSync } from 'fs';
import { pipeline, Readable, Transform } from 'stream';
import { promisify } from 'util';
import sax from 'sax';
// @ts-ignore - stream-json doesn't have perfect types
import { parser as jsonParser } from 'stream-json';
// @ts-ignore
import { streamArray } from 'stream-json/streamers/StreamArray.js';
// @ts-ignore
import { streamObject } from 'stream-json/streamers/StreamObject.js';

const pipelineAsync = promisify(pipeline);

export type FileFormat = 'json' | 'xml' | 'google-takeout' | 'chat-transcript' | 'auto';

export interface ImportOptions {
  tableName: string;
  format?: FileFormat;
  batchSize?: number;
  rootElement?: string; // For XML - which element contains records
  idField?: string; // Field to use as ID (default: auto-generate)
  onProgress?: (processed: number, total: number | null) => void;
}

export interface ImportResult {
  success: boolean;
  recordsProcessed: number;
  recordsFailed: number;
  errors: string[];
  duration: number;
  format: string;
}

interface ParsedRecord {
  id?: string;
  content: any;
}

@injectable()
export class FileImportService {
  constructor(@inject(DatabaseConnection) private db: DatabaseConnection) {}

  /**
   * Import a file into the database with streaming support for large files
   */
  async importFile(
    filePath: string,
    options: ImportOptions
  ): Promise<ImportResult> {
    const startTime = Date.now();
    const format = options.format || this.detectFormat(filePath);
    const batchSize = options.batchSize || 500;

    console.log(`[IMPORT] Starting import from ${filePath}`);
    console.log(`[IMPORT] Detected format: ${format}, batch size: ${batchSize}`);

    // Get file size for progress reporting
    let fileSize: number | null = null;
    try {
      const stats = statSync(filePath);
      fileSize = stats.size;
      console.log(`[IMPORT] File size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
    } catch {
      console.log(`[IMPORT] Could not get file size`);
    }

    // Ensure target table exists
    await this.ensureTableExists(options.tableName);

    const result: ImportResult = {
      success: true,
      recordsProcessed: 0,
      recordsFailed: 0,
      errors: [],
      duration: 0,
      format,
    };

    try {
      switch (format) {
        case 'xml':
          await this.importXmlStreaming(filePath, options, result, batchSize);
          break;
        case 'google-takeout':
          await this.importGoogleTakeout(filePath, options, result, batchSize);
          break;
        case 'chat-transcript':
          await this.importChatTranscript(filePath, options, result, batchSize);
          break;
        case 'json':
        default:
          await this.importJsonStreaming(filePath, options, result, batchSize);
          break;
      }
    } catch (error: any) {
      result.success = false;
      result.errors.push(`Fatal error: ${error.message}`);
      console.error(`[IMPORT] Fatal error:`, error);
    }

    result.duration = Date.now() - startTime;
    console.log(`[IMPORT] Complete. Processed: ${result.recordsProcessed}, Failed: ${result.recordsFailed}, Duration: ${result.duration}ms`);

    return result;
  }

  /**
   * Import from a stream (for direct uploads without saving to disk)
   */
  async importFromStream(
    stream: Readable,
    options: ImportOptions & { format: FileFormat }
  ): Promise<ImportResult> {
    const startTime = Date.now();
    const batchSize = options.batchSize || 500;

    console.log(`[IMPORT] Starting stream import, format: ${options.format}`);

    await this.ensureTableExists(options.tableName);

    const result: ImportResult = {
      success: true,
      recordsProcessed: 0,
      recordsFailed: 0,
      errors: [],
      duration: 0,
      format: options.format,
    };

    try {
      switch (options.format) {
        case 'xml':
          await this.parseXmlStream(stream, options, result, batchSize);
          break;
        case 'google-takeout':
          await this.parseGoogleTakeoutStream(stream, options, result, batchSize);
          break;
        case 'chat-transcript':
          await this.parseChatTranscriptStream(stream, options, result, batchSize);
          break;
        case 'json':
        default:
          await this.parseJsonStream(stream, options, result, batchSize);
          break;
      }
    } catch (error: any) {
      result.success = false;
      result.errors.push(`Fatal error: ${error.message}`);
    }

    result.duration = Date.now() - startTime;
    return result;
  }

  private detectFormat(filePath: string): FileFormat {
    const ext = filePath.toLowerCase().split('.').pop();

    if (ext === 'xml') return 'xml';

    // Check filename patterns for Google Takeout
    const fileName = filePath.toLowerCase();
    if (fileName.includes('takeout') ||
        fileName.includes('activity') ||
        fileName.includes('my_activity') ||
        fileName.includes('watch-history') ||
        fileName.includes('search-history')) {
      return 'google-takeout';
    }

    // Check for chat patterns
    if (fileName.includes('chat') ||
        fileName.includes('message') ||
        fileName.includes('conversation') ||
        fileName.includes('transcript')) {
      return 'chat-transcript';
    }

    return 'json';
  }

  private async ensureTableExists(tableName: string): Promise<void> {
    const toProcessTable = `${tableName}_toprocess`;

    // Create the _toprocess table
    const createToProcess = `
      CREATE TABLE IF NOT EXISTS \`${toProcessTable}\` (
        id VARCHAR(255) PRIMARY KEY,
        content JSON NOT NULL,
        imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_imported_at (imported_at)
      )
    `;

    // Create the archive table
    const createArchive = `
      CREATE TABLE IF NOT EXISTS \`${tableName}\` (
        id VARCHAR(255) PRIMARY KEY,
        content JSON NOT NULL,
        processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_processed_at (processed_at)
      )
    `;

    await Promise.all([
      this.db.rawQuery(createToProcess),
      this.db.rawQuery(createArchive),
    ]);

    console.log(`[IMPORT] Ensured tables exist: ${toProcessTable}, ${tableName}`);
  }

  private async insertBatch(
    tableName: string,
    records: ParsedRecord[],
    result: ImportResult
  ): Promise<void> {
    if (records.length === 0) return;

    const toProcessTable = `${tableName}_toprocess`;

    for (const record of records) {
      try {
        const id = record.id || this.generateId();
        const content = typeof record.content === 'string'
          ? record.content
          : JSON.stringify(record.content);

        await this.db.query(
          `INSERT IGNORE INTO \`${toProcessTable}\` (id, content) VALUES (?, ?)`,
          [id, content]
        );
        result.recordsProcessed++;
      } catch (error: any) {
        result.recordsFailed++;
        if (result.errors.length < 100) {
          result.errors.push(`Record ${record.id || 'unknown'}: ${error.message}`);
        }
      }
    }
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // ========== JSON Streaming Import ==========

  private async importJsonStreaming(
    filePath: string,
    options: ImportOptions,
    result: ImportResult,
    batchSize: number
  ): Promise<void> {
    const stream = createReadStream(filePath, { encoding: 'utf8' });
    await this.parseJsonStream(stream, options, result, batchSize);
  }

  private async parseJsonStream(
    stream: Readable,
    options: ImportOptions,
    result: ImportResult,
    batchSize: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const batch: ParsedRecord[] = [];
      let isArray = false;
      let firstChunk = true;

      // Buffer for detecting structure
      let buffer = '';

      const processRecord = async (record: any) => {
        const id = options.idField ? this.extractField(record, options.idField) : undefined;
        batch.push({ id, content: record });

        if (batch.length >= batchSize) {
          const toInsert = batch.splice(0, batchSize);
          await this.insertBatch(options.tableName, toInsert, result);
          options.onProgress?.(result.recordsProcessed, null);
        }
      };

      // Create a transform to detect JSON structure
      const detectTransform = new Transform({
        objectMode: false,
        transform(chunk, encoding, callback) {
          if (firstChunk) {
            buffer += chunk.toString();
            // Check if it's an array
            const trimmed = buffer.trimStart();
            if (trimmed.startsWith('[')) {
              isArray = true;
            }
            firstChunk = false;
          }
          this.push(chunk);
          callback();
        }
      });

      // For array JSON files, use streamArray
      // For object JSON files (like Google Takeout), use streamObject
      stream.pipe(detectTransform);

      // We'll try to parse as array first, then fall back to object
      const parser = jsonParser();
      const arrayStreamer = streamArray();

      let processingPromises: Promise<void>[] = [];

      detectTransform
        .pipe(parser)
        .pipe(arrayStreamer)
        .on('data', ({ value }: { value: any }) => {
          processingPromises.push(processRecord(value));
        })
        .on('end', async () => {
          try {
            await Promise.all(processingPromises);
            // Insert remaining records
            if (batch.length > 0) {
              await this.insertBatch(options.tableName, batch, result);
            }
            resolve();
          } catch (error) {
            reject(error);
          }
        })
        .on('error', async (error: Error) => {
          // If streaming failed, try parsing as single object or line-delimited
          console.log(`[IMPORT] Array streaming failed, trying alternative parsing: ${error.message}`);
          try {
            await this.parseJsonAlternative(stream, options, result, batchSize);
            resolve();
          } catch (altError) {
            reject(altError);
          }
        });
    });
  }

  private async parseJsonAlternative(
    originalStream: Readable,
    options: ImportOptions,
    result: ImportResult,
    batchSize: number
  ): Promise<void> {
    // For non-array JSON, accumulate and parse as single object
    // This handles Google Takeout format with nested structures
    let data = '';

    return new Promise((resolve, reject) => {
      originalStream
        .on('data', (chunk: Buffer | string) => {
          data += chunk.toString();
        })
        .on('end', async () => {
          try {
            const parsed = JSON.parse(data);

            // Handle Google Takeout nested structure
            const records = this.extractRecordsFromObject(parsed, options);

            const batch: ParsedRecord[] = [];
            for (const record of records) {
              batch.push(record);
              if (batch.length >= batchSize) {
                const toInsert = batch.splice(0, batchSize);
                await this.insertBatch(options.tableName, toInsert, result);
              }
            }

            if (batch.length > 0) {
              await this.insertBatch(options.tableName, batch, result);
            }

            resolve();
          } catch (error) {
            reject(error);
          }
        })
        .on('error', reject);
    });
  }

  private extractRecordsFromObject(obj: any, options: ImportOptions): ParsedRecord[] {
    const records: ParsedRecord[] = [];

    // If it's an array at root level
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const id = options.idField ? this.extractField(item, options.idField) : undefined;
        records.push({ id, content: item });
      }
      return records;
    }

    // Look for common array properties in the object
    const arrayKeys = ['items', 'data', 'records', 'messages', 'events', 'activities', 'history'];

    for (const key of arrayKeys) {
      if (Array.isArray(obj[key])) {
        for (const item of obj[key]) {
          const id = options.idField ? this.extractField(item, options.idField) : undefined;
          records.push({ id, content: item });
        }
        return records;
      }
    }

    // Recursively search for arrays
    for (const key in obj) {
      if (Array.isArray(obj[key]) && obj[key].length > 0 && typeof obj[key][0] === 'object') {
        for (const item of obj[key]) {
          const id = options.idField ? this.extractField(item, options.idField) : undefined;
          records.push({ id, content: item });
        }
        return records;
      }
    }

    // If no arrays found, treat the whole object as a single record
    const id = options.idField ? this.extractField(obj, options.idField) : undefined;
    records.push({ id, content: obj });

    return records;
  }

  // ========== XML Streaming Import ==========

  private async importXmlStreaming(
    filePath: string,
    options: ImportOptions,
    result: ImportResult,
    batchSize: number
  ): Promise<void> {
    const stream = createReadStream(filePath, { encoding: 'utf8' });
    await this.parseXmlStream(stream, options, result, batchSize);
  }

  private async parseXmlStream(
    stream: Readable,
    options: ImportOptions,
    result: ImportResult,
    batchSize: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const saxParser = sax.createStream(true, { trim: true, normalize: true });
      const batch: ParsedRecord[] = [];

      // Track current element path and content
      const elementStack: { name: string; attributes: any; text: string; children: any[] }[] = [];
      let currentRecord: any = null;
      const rootElement = options.rootElement || this.detectXmlRootElement(options.tableName);
      let recordDepth = -1;
      let processingPromises: Promise<void>[] = [];

      saxParser.on('opentag', (node: sax.Tag) => {
        const element = {
          name: node.name,
          attributes: node.attributes,
          text: '',
          children: [],
        };

        if (node.name.toLowerCase() === rootElement.toLowerCase()) {
          currentRecord = {};
          recordDepth = elementStack.length;
        }

        elementStack.push(element);
      });

      saxParser.on('text', (text: string) => {
        if (elementStack.length > 0) {
          elementStack[elementStack.length - 1].text += text;
        }
      });

      saxParser.on('cdata', (cdata: string) => {
        if (elementStack.length > 0) {
          elementStack[elementStack.length - 1].text += cdata;
        }
      });

      saxParser.on('closetag', async (tagName: string) => {
        const element = elementStack.pop();
        if (!element) return;

        // Build element value
        let value: any;
        if (element.children.length > 0) {
          value = {};
          for (const child of element.children) {
            if (value[child.name]) {
              // Convert to array if multiple same-named children
              if (!Array.isArray(value[child.name])) {
                value[child.name] = [value[child.name]];
              }
              value[child.name].push(child.value);
            } else {
              value[child.name] = child.value;
            }
          }
          // Add attributes
          if (Object.keys(element.attributes).length > 0) {
            value['@attributes'] = element.attributes;
          }
        } else {
          value = element.text.trim() || (Object.keys(element.attributes).length > 0 ? element.attributes : null);
        }

        // Add to parent's children
        if (elementStack.length > 0) {
          elementStack[elementStack.length - 1].children.push({
            name: element.name,
            value,
          });
        }

        // Check if this closes a record element
        if (elementStack.length === recordDepth && currentRecord !== null) {
          // Build the record from children
          if (element.children.length > 0) {
            for (const child of element.children) {
              currentRecord[child.name] = child.value;
            }
          }

          // Add attributes to record
          if (Object.keys(element.attributes).length > 0) {
            currentRecord['@attributes'] = element.attributes;
          }

          const id = options.idField
            ? this.extractField(currentRecord, options.idField)
            : currentRecord['@attributes']?.id || currentRecord.id;

          batch.push({ id, content: currentRecord });
          currentRecord = null;
          recordDepth = -1;

          if (batch.length >= batchSize) {
            const toInsert = batch.splice(0, batchSize);
            processingPromises.push(this.insertBatch(options.tableName, toInsert, result));
            options.onProgress?.(result.recordsProcessed, null);
          }
        }
      });

      saxParser.on('error', (error: Error) => {
        console.error(`[IMPORT] XML parsing error: ${error.message}`);
        if (result.errors.length < 100) {
          result.errors.push(`XML parse error: ${error.message}`);
        }
        // Continue parsing
        (saxParser as any).resume();
      });

      saxParser.on('end', async () => {
        try {
          await Promise.all(processingPromises);
          if (batch.length > 0) {
            await this.insertBatch(options.tableName, batch, result);
          }
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      stream.pipe(saxParser);
      stream.on('error', reject);
    });
  }

  private detectXmlRootElement(tableName: string): string {
    // Common root element patterns
    const singular = tableName.replace(/_/g, '').toLowerCase();
    const patterns = ['item', 'record', 'row', 'entry', 'element', singular];

    // Remove trailing 's' for plural table names
    if (singular.endsWith('s')) {
      patterns.push(singular.slice(0, -1));
    }

    return patterns[0]; // Default to 'item'
  }

  // ========== Google Takeout Import ==========

  private async importGoogleTakeout(
    filePath: string,
    options: ImportOptions,
    result: ImportResult,
    batchSize: number
  ): Promise<void> {
    const stream = createReadStream(filePath, { encoding: 'utf8' });
    await this.parseGoogleTakeoutStream(stream, options, result, batchSize);
  }

  private async parseGoogleTakeoutStream(
    stream: Readable,
    options: ImportOptions,
    result: ImportResult,
    batchSize: number
  ): Promise<void> {
    // Google Takeout files are typically JSON arrays or objects with specific structures
    // Common patterns:
    // - YouTube watch history: array of objects with "header", "title", "titleUrl", "time"
    // - Search history: array with "title", "time", "products"
    // - Location history: object with "locations" array
    // - My Activity: array with "header", "title", "time", "products"

    let data = '';

    return new Promise((resolve, reject) => {
      stream
        .on('data', (chunk: Buffer | string) => {
          data += chunk.toString();
        })
        .on('end', async () => {
          try {
            const parsed = JSON.parse(data);
            const records = this.extractGoogleTakeoutRecords(parsed, options);

            const batch: ParsedRecord[] = [];
            for (const record of records) {
              batch.push(record);
              if (batch.length >= batchSize) {
                const toInsert = batch.splice(0, batchSize);
                await this.insertBatch(options.tableName, toInsert, result);
                options.onProgress?.(result.recordsProcessed, null);
              }
            }

            if (batch.length > 0) {
              await this.insertBatch(options.tableName, batch, result);
            }

            resolve();
          } catch (error: any) {
            result.errors.push(`Google Takeout parse error: ${error.message}`);
            reject(error);
          }
        })
        .on('error', reject);
    });
  }

  private extractGoogleTakeoutRecords(data: any, options: ImportOptions): ParsedRecord[] {
    const records: ParsedRecord[] = [];

    // If it's an array (most common for activity data)
    if (Array.isArray(data)) {
      for (const item of data) {
        const normalized = this.normalizeGoogleTakeoutItem(item);
        const id = this.generateGoogleTakeoutId(normalized);
        records.push({ id, content: normalized });
      }
      return records;
    }

    // Handle nested structures
    // Location History format
    if (data.locations && Array.isArray(data.locations)) {
      for (const location of data.locations) {
        const normalized = this.normalizeLocationItem(location);
        const id = this.generateGoogleTakeoutId(normalized);
        records.push({ id, content: normalized });
      }
      return records;
    }

    // Semantic Location History
    if (data.timelineObjects && Array.isArray(data.timelineObjects)) {
      for (const obj of data.timelineObjects) {
        const normalized = this.normalizeTimelineObject(obj);
        const id = this.generateGoogleTakeoutId(normalized);
        records.push({ id, content: normalized });
      }
      return records;
    }

    // Generic nested array search
    for (const key in data) {
      if (Array.isArray(data[key]) && data[key].length > 0) {
        for (const item of data[key]) {
          if (typeof item === 'object' && item !== null) {
            const normalized = this.normalizeGoogleTakeoutItem(item);
            const id = this.generateGoogleTakeoutId(normalized);
            records.push({ id, content: { ...normalized, _sourceKey: key } });
          }
        }
        return records;
      }
    }

    // Single object
    const id = this.generateGoogleTakeoutId(data);
    records.push({ id, content: data });

    return records;
  }

  private normalizeGoogleTakeoutItem(item: any): any {
    // Normalize common Google Takeout fields
    const normalized: any = { ...item };

    // Normalize timestamps
    if (item.time) {
      normalized.timestamp = new Date(item.time).toISOString();
      normalized.time_unix = new Date(item.time).getTime();
    }
    if (item.timestampMs) {
      normalized.timestamp = new Date(parseInt(item.timestampMs)).toISOString();
      normalized.time_unix = parseInt(item.timestampMs);
    }

    // Extract URLs
    if (item.titleUrl) {
      normalized.url = item.titleUrl;
      // Extract video ID for YouTube
      const match = item.titleUrl.match(/[?&]v=([^&]+)/);
      if (match) {
        normalized.youtube_video_id = match[1];
      }
    }

    // Flatten subtitles array
    if (item.subtitles && Array.isArray(item.subtitles)) {
      normalized.channel_name = item.subtitles[0]?.name;
      normalized.channel_url = item.subtitles[0]?.url;
    }

    // Flatten products array
    if (item.products && Array.isArray(item.products)) {
      normalized.products_list = item.products.join(', ');
    }

    // Flatten details array
    if (item.details && Array.isArray(item.details)) {
      normalized.details_text = item.details.map((d: any) => d.name || d).join('; ');
    }

    return normalized;
  }

  private normalizeLocationItem(location: any): any {
    const normalized: any = { ...location };

    // Convert E7 coordinates to decimal
    if (location.latitudeE7) {
      normalized.latitude = location.latitudeE7 / 1e7;
    }
    if (location.longitudeE7) {
      normalized.longitude = location.longitudeE7 / 1e7;
    }

    // Normalize timestamp
    if (location.timestampMs) {
      normalized.timestamp = new Date(parseInt(location.timestampMs)).toISOString();
    }
    if (location.timestamp) {
      normalized.timestamp = new Date(location.timestamp).toISOString();
    }

    return normalized;
  }

  private normalizeTimelineObject(obj: any): any {
    // Handle activitySegment and placeVisit
    if (obj.activitySegment) {
      return {
        type: 'activity',
        ...obj.activitySegment,
        startTimestamp: obj.activitySegment.duration?.startTimestamp,
        endTimestamp: obj.activitySegment.duration?.endTimestamp,
      };
    }
    if (obj.placeVisit) {
      return {
        type: 'place_visit',
        ...obj.placeVisit,
        placeName: obj.placeVisit.location?.name,
        placeAddress: obj.placeVisit.location?.address,
        latitude: obj.placeVisit.location?.latitudeE7 ? obj.placeVisit.location.latitudeE7 / 1e7 : undefined,
        longitude: obj.placeVisit.location?.longitudeE7 ? obj.placeVisit.location.longitudeE7 / 1e7 : undefined,
      };
    }
    return obj;
  }

  private generateGoogleTakeoutId(item: any): string {
    // Generate a unique ID based on content
    const parts = [
      item.timestamp || item.time || '',
      item.title || '',
      item.header || '',
      item.url || item.titleUrl || '',
    ].filter(Boolean).join('|');

    if (parts) {
      // Simple hash
      let hash = 0;
      for (let i = 0; i < parts.length; i++) {
        const char = parts.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      return `gt-${Math.abs(hash).toString(36)}`;
    }

    return this.generateId();
  }

  // ========== Chat Transcript Import ==========

  private async importChatTranscript(
    filePath: string,
    options: ImportOptions,
    result: ImportResult,
    batchSize: number
  ): Promise<void> {
    const stream = createReadStream(filePath, { encoding: 'utf8' });
    await this.parseChatTranscriptStream(stream, options, result, batchSize);
  }

  private async parseChatTranscriptStream(
    stream: Readable,
    options: ImportOptions,
    result: ImportResult,
    batchSize: number
  ): Promise<void> {
    // Chat transcripts can come in many formats:
    // - Discord: array of messages with author, content, timestamp
    // - Slack: array with messages, user info
    // - WhatsApp exports: text-based but we handle JSON
    // - Generic: array of message objects
    // - Claude/ChatGPT: conversation format with messages array

    let data = '';

    return new Promise((resolve, reject) => {
      stream
        .on('data', (chunk: Buffer | string) => {
          data += chunk.toString();
        })
        .on('end', async () => {
          try {
            const parsed = JSON.parse(data);
            const records = this.extractChatRecords(parsed, options);

            const batch: ParsedRecord[] = [];
            for (const record of records) {
              batch.push(record);
              if (batch.length >= batchSize) {
                const toInsert = batch.splice(0, batchSize);
                await this.insertBatch(options.tableName, toInsert, result);
                options.onProgress?.(result.recordsProcessed, null);
              }
            }

            if (batch.length > 0) {
              await this.insertBatch(options.tableName, batch, result);
            }

            resolve();
          } catch (error: any) {
            result.errors.push(`Chat transcript parse error: ${error.message}`);
            reject(error);
          }
        })
        .on('error', reject);
    });
  }

  private extractChatRecords(data: any, options: ImportOptions): ParsedRecord[] {
    const records: ParsedRecord[] = [];

    // Direct array of messages
    if (Array.isArray(data)) {
      for (const message of data) {
        const normalized = this.normalizeChatMessage(message);
        const id = this.generateChatMessageId(normalized);
        records.push({ id, content: normalized });
      }
      return records;
    }

    // Discord export format
    if (data.messages && Array.isArray(data.messages)) {
      const channelInfo = {
        channel_id: data.channel?.id,
        channel_name: data.channel?.name,
        guild_id: data.guild?.id,
        guild_name: data.guild?.name,
      };

      for (const message of data.messages) {
        const normalized = this.normalizeChatMessage({ ...message, ...channelInfo });
        const id = message.id || this.generateChatMessageId(normalized);
        records.push({ id, content: normalized });
      }
      return records;
    }

    // Slack export format
    if (data.length > 0 && data[0].type === 'message') {
      for (const message of data) {
        const normalized = this.normalizeChatMessage(message);
        const id = message.ts || this.generateChatMessageId(normalized);
        records.push({ id, content: normalized });
      }
      return records;
    }

    // Claude/ChatGPT conversation format
    if (data.mapping || data.conversation || data.messages) {
      const messages = data.messages || data.conversation || [];

      // Handle OpenAI/Claude mapping format
      if (data.mapping) {
        const extractedMessages = this.extractFromMapping(data.mapping);
        for (const msg of extractedMessages) {
          const normalized = this.normalizeChatMessage(msg);
          const id = msg.id || this.generateChatMessageId(normalized);
          records.push({ id, content: normalized });
        }
        return records;
      }

      for (const message of messages) {
        const normalized = this.normalizeChatMessage(message);
        const id = message.id || this.generateChatMessageId(normalized);
        records.push({ id, content: normalized });
      }
      return records;
    }

    // Generic nested search
    for (const key in data) {
      if (Array.isArray(data[key]) && data[key].length > 0) {
        const first = data[key][0];
        if (this.looksLikeChatMessage(first)) {
          for (const message of data[key]) {
            const normalized = this.normalizeChatMessage(message);
            const id = this.generateChatMessageId(normalized);
            records.push({ id, content: { ...normalized, _sourceKey: key } });
          }
          return records;
        }
      }
    }

    // Single conversation object
    const id = this.generateId();
    records.push({ id, content: data });

    return records;
  }

  private extractFromMapping(mapping: any): any[] {
    const messages: any[] = [];

    for (const nodeId in mapping) {
      const node = mapping[nodeId];
      if (node.message && node.message.content) {
        messages.push({
          id: nodeId,
          role: node.message.author?.role || node.message.role,
          content: node.message.content.parts?.join('\n') || node.message.content,
          timestamp: node.message.create_time,
        });
      }
    }

    // Sort by timestamp if available
    messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    return messages;
  }

  private looksLikeChatMessage(obj: any): boolean {
    if (typeof obj !== 'object' || obj === null) return false;

    const chatFields = ['content', 'text', 'message', 'body', 'author', 'sender', 'user', 'role', 'timestamp', 'time', 'ts'];
    const matchCount = chatFields.filter(field => field in obj).length;

    return matchCount >= 2;
  }

  private normalizeChatMessage(message: any): any {
    const normalized: any = { ...message };

    // Normalize author/sender
    if (message.author && typeof message.author === 'object') {
      normalized.author_id = message.author.id;
      normalized.author_name = message.author.name || message.author.username;
      normalized.author_discriminator = message.author.discriminator;
      normalized.is_bot = message.author.bot || message.author.isBot;
    }
    if (message.user && typeof message.user === 'string') {
      normalized.author_id = message.user;
    }
    if (message.sender) {
      normalized.author_name = typeof message.sender === 'object' ? message.sender.name : message.sender;
    }

    // Normalize content
    if (message.text && !message.content) {
      normalized.content = message.text;
    }
    if (message.body && !message.content) {
      normalized.content = message.body;
    }

    // Normalize timestamp
    if (message.timestamp) {
      try {
        normalized.timestamp_iso = new Date(message.timestamp).toISOString();
        normalized.timestamp_unix = new Date(message.timestamp).getTime();
      } catch {
        // Keep original if parsing fails
      }
    }
    if (message.ts) {
      // Slack timestamp format
      const tsNum = parseFloat(message.ts);
      normalized.timestamp_iso = new Date(tsNum * 1000).toISOString();
      normalized.timestamp_unix = Math.floor(tsNum * 1000);
    }
    if (message.create_time) {
      normalized.timestamp_iso = new Date(message.create_time * 1000).toISOString();
      normalized.timestamp_unix = message.create_time * 1000;
    }

    // Flatten attachments
    if (message.attachments && Array.isArray(message.attachments)) {
      normalized.attachment_count = message.attachments.length;
      normalized.attachment_urls = message.attachments.map((a: any) => a.url || a.proxy_url).filter(Boolean);
    }

    // Flatten reactions
    if (message.reactions && Array.isArray(message.reactions)) {
      normalized.reaction_count = message.reactions.reduce((sum: number, r: any) => sum + (r.count || 1), 0);
      normalized.reaction_emojis = message.reactions.map((r: any) => r.emoji?.name || r.name).filter(Boolean);
    }

    // Flatten mentions
    if (message.mentions && Array.isArray(message.mentions)) {
      normalized.mention_count = message.mentions.length;
      normalized.mentioned_users = message.mentions.map((m: any) => m.username || m.name || m).filter(Boolean);
    }

    return normalized;
  }

  private generateChatMessageId(message: any): string {
    const parts = [
      message.timestamp_unix || message.timestamp || message.ts || '',
      message.author_id || message.author_name || message.user || '',
      (message.content || message.text || '').substring(0, 50),
    ].filter(Boolean).join('|');

    if (parts) {
      let hash = 0;
      for (let i = 0; i < parts.length; i++) {
        const char = parts.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      return `chat-${Math.abs(hash).toString(36)}`;
    }

    return this.generateId();
  }

  // ========== Utility Methods ==========

  private extractField(obj: any, path: string): any {
    const parts = path.split('.');
    let current = obj;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = current[part];
    }

    return current;
  }

  /**
   * Get supported formats and their descriptions
   */
  getSupportedFormats(): { format: FileFormat; description: string; extensions: string[] }[] {
    return [
      {
        format: 'json',
        description: 'Standard JSON files (arrays or objects)',
        extensions: ['.json'],
      },
      {
        format: 'xml',
        description: 'XML files with streaming support for large files',
        extensions: ['.xml'],
      },
      {
        format: 'google-takeout',
        description: 'Google Takeout exports (YouTube history, search history, location data, etc.)',
        extensions: ['.json'],
      },
      {
        format: 'chat-transcript',
        description: 'Chat transcripts (Discord, Slack, ChatGPT, Claude, etc.)',
        extensions: ['.json'],
      },
    ];
  }
}
