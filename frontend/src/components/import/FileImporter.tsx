import React, { useState, useRef, useCallback } from 'react';

interface ImportFormat {
  format: string;
  description: string;
  extensions: string[];
}

interface ImportResult {
  success: boolean;
  recordsProcessed: number;
  recordsFailed: number;
  errors: string[];
  duration: number;
  format: string;
  originalFilename?: string;
  fileSize?: number;
}

interface AnalysisResult {
  originalFilename: string;
  fileSize: number;
  detectedFormat: string;
  recordsAnalyzed: number;
  sampleRecords: any[];
  fields: { path: string; types: string[]; samples: any[] }[];
  estimatedTotalRecords: number;
}

interface FileImporterProps {
  onImportComplete?: (result: ImportResult) => void;
  onClose?: () => void;
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export const FileImporter: React.FC<FileImporterProps> = ({ onImportComplete, onClose }) => {
  const [file, setFile] = useState<File | null>(null);
  const [tableName, setTableName] = useState('');
  const [format, setFormat] = useState<string>('auto');
  const [batchSize, setBatchSize] = useState(500);
  const [rootElement, setRootElement] = useState('');
  const [idField, setIdField] = useState('');

  const [isUploading, setIsUploading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formats, setFormats] = useState<ImportFormat[]>([]);
  const [dragActive, setDragActive] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch supported formats on mount
  React.useEffect(() => {
    fetch(`${API_BASE}/api/import/formats`)
      .then(res => res.json())
      .then(data => setFormats(data.formats || []))
      .catch(err => console.error('Failed to fetch formats:', err));
  }, []);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      setFile(droppedFile);

      // Auto-detect format from filename
      const name = droppedFile.name.toLowerCase();
      if (name.endsWith('.xml')) {
        setFormat('xml');
      } else if (name.includes('takeout') || name.includes('activity') || name.includes('history')) {
        setFormat('google-takeout');
      } else if (name.includes('chat') || name.includes('message') || name.includes('transcript')) {
        setFormat('chat-transcript');
      } else {
        setFormat('auto');
      }

      // Suggest table name from filename
      const baseName = droppedFile.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      if (!tableName) {
        setTableName(baseName);
      }
    }
  }, [tableName]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);

      // Auto-detect format from filename
      const name = selectedFile.name.toLowerCase();
      if (name.endsWith('.xml')) {
        setFormat('xml');
      } else if (name.includes('takeout') || name.includes('activity') || name.includes('history')) {
        setFormat('google-takeout');
      } else if (name.includes('chat') || name.includes('message') || name.includes('transcript')) {
        setFormat('chat-transcript');
      } else {
        setFormat('auto');
      }

      // Suggest table name from filename
      const baseName = selectedFile.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      if (!tableName) {
        setTableName(baseName);
      }
    }
  };

  const handleAnalyze = async () => {
    if (!file) return;

    setIsAnalyzing(true);
    setError(null);
    setAnalysis(null);

    const formData = new FormData();
    formData.append('file', file);
    if (format !== 'auto') {
      formData.append('format', format);
    }
    formData.append('sampleSize', '10');

    try {
      const response = await fetch(`${API_BASE}/api/import/analyze`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Analysis failed');
      }

      setAnalysis(data);
      setFormat(data.detectedFormat);
    } catch (err: any) {
      setError(err.message || 'Analysis failed');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleImport = async () => {
    if (!file || !tableName) return;

    setIsUploading(true);
    setError(null);
    setResult(null);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('tableName', tableName);
    formData.append('format', format);
    formData.append('batchSize', batchSize.toString());
    if (rootElement) {
      formData.append('rootElement', rootElement);
    }
    if (idField) {
      formData.append('idField', idField);
    }

    try {
      // Use XMLHttpRequest for progress tracking
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded / event.total) * 100);
          setUploadProgress(progress);
        }
      });

      const response = await new Promise<ImportResult>((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            try {
              const error = JSON.parse(xhr.responseText);
              reject(new Error(error.message || error.error || 'Import failed'));
            } catch {
              reject(new Error('Import failed'));
            }
          }
        };
        xhr.onerror = () => reject(new Error('Network error'));

        xhr.open('POST', `${API_BASE}/api/import/file`);
        xhr.send(formData);
      });

      setResult(response);
      onImportComplete?.(response);
    } catch (err: any) {
      setError(err.message || 'Import failed');
    } finally {
      setIsUploading(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div style={{
        backgroundColor: 'white',
        borderRadius: '8px',
        padding: '24px',
        maxWidth: '800px',
        width: '90%',
        maxHeight: '90vh',
        overflow: 'auto',
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0 }}>Import File</h2>
          {onClose && (
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '24px',
                cursor: 'pointer',
                color: '#666',
              }}
            >
              x
            </button>
          )}
        </div>

        {/* Drag and Drop Zone */}
        <div
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${dragActive ? '#007bff' : '#ccc'}`,
            borderRadius: '8px',
            padding: '40px',
            textAlign: 'center',
            backgroundColor: dragActive ? '#f0f7ff' : '#fafafa',
            cursor: 'pointer',
            transition: 'all 0.2s',
            marginBottom: '20px',
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.xml"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />

          {file ? (
            <div>
              <div style={{ fontSize: '48px', marginBottom: '10px' }}>
                {file.name.endsWith('.xml') ? 'XML' : 'JSON'}
              </div>
              <div style={{ fontWeight: 'bold', fontSize: '18px' }}>{file.name}</div>
              <div style={{ color: '#666', marginTop: '5px' }}>{formatFileSize(file.size)}</div>
              <div style={{ color: '#007bff', marginTop: '10px', fontSize: '14px' }}>
                Click or drop to change file
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: '48px', marginBottom: '10px', opacity: 0.5 }}>+</div>
              <div style={{ fontSize: '18px', color: '#666' }}>
                Drop your file here or click to browse
              </div>
              <div style={{ color: '#999', marginTop: '10px', fontSize: '14px' }}>
                Supports JSON, XML, Google Takeout, Chat Transcripts (up to 5GB)
              </div>
            </div>
          )}
        </div>

        {/* Configuration */}
        {file && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>
                Table Name *
              </label>
              <input
                type="text"
                value={tableName}
                onChange={(e) => setTableName(e.target.value.replace(/[^a-zA-Z0-9_]/g, '_'))}
                placeholder="my_data"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '4px',
                  border: '1px solid #ccc',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                Data will be imported to {tableName || 'table'}_toprocess
              </div>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>
                Format
              </label>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '4px',
                  border: '1px solid #ccc',
                  boxSizing: 'border-box',
                }}
              >
                <option value="auto">Auto-detect</option>
                <option value="json">JSON (Standard)</option>
                <option value="xml">XML (Streaming)</option>
                <option value="google-takeout">Google Takeout</option>
                <option value="chat-transcript">Chat Transcript</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>
                Batch Size
              </label>
              <input
                type="number"
                value={batchSize}
                onChange={(e) => setBatchSize(parseInt(e.target.value) || 500)}
                min={1}
                max={10000}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '4px',
                  border: '1px solid #ccc',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                Records per database batch (lower = less memory)
              </div>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>
                ID Field (optional)
              </label>
              <input
                type="text"
                value={idField}
                onChange={(e) => setIdField(e.target.value)}
                placeholder="e.g., _id or data.id"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '4px',
                  border: '1px solid #ccc',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {format === 'xml' && (
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>
                  Root Element (for XML)
                </label>
                <input
                  type="text"
                  value={rootElement}
                  onChange={(e) => setRootElement(e.target.value)}
                  placeholder="e.g., item, record, row"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '4px',
                    border: '1px solid #ccc',
                    boxSizing: 'border-box',
                  }}
                />
                <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                  Which XML element represents each record (default: auto-detect)
                </div>
              </div>
            )}
          </div>
        )}

        {/* Format descriptions */}
        {format !== 'auto' && formats.length > 0 && (
          <div style={{
            backgroundColor: '#f8f9fa',
            padding: '12px',
            borderRadius: '4px',
            marginBottom: '20px',
            fontSize: '14px',
          }}>
            {formats.find(f => f.format === format)?.description}
          </div>
        )}

        {/* Analysis Results */}
        {analysis && (
          <div style={{
            backgroundColor: '#e8f5e9',
            padding: '16px',
            borderRadius: '4px',
            marginBottom: '20px',
          }}>
            <h4 style={{ margin: '0 0 12px 0' }}>File Analysis</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '12px' }}>
              <div>
                <strong>Format:</strong> {analysis.detectedFormat}
              </div>
              <div>
                <strong>Records:</strong> ~{analysis.estimatedTotalRecords}
              </div>
              <div>
                <strong>Fields:</strong> {analysis.fields.length}
              </div>
            </div>

            {analysis.fields.length > 0 && (
              <div>
                <strong>Detected Fields:</strong>
                <div style={{
                  maxHeight: '100px',
                  overflow: 'auto',
                  backgroundColor: 'white',
                  padding: '8px',
                  borderRadius: '4px',
                  marginTop: '8px',
                  fontSize: '12px',
                  fontFamily: 'monospace',
                }}>
                  {analysis.fields.slice(0, 20).map((f, i) => (
                    <div key={i}>{f.path} ({f.types.join(', ')})</div>
                  ))}
                  {analysis.fields.length > 20 && (
                    <div style={{ color: '#666' }}>...and {analysis.fields.length - 20} more</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Progress */}
        {isUploading && (
          <div style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span>Uploading...</span>
              <span>{uploadProgress}%</span>
            </div>
            <div style={{
              height: '8px',
              backgroundColor: '#e0e0e0',
              borderRadius: '4px',
              overflow: 'hidden',
            }}>
              <div style={{
                height: '100%',
                width: `${uploadProgress}%`,
                backgroundColor: '#007bff',
                transition: 'width 0.3s',
              }} />
            </div>
            {uploadProgress === 100 && (
              <div style={{ marginTop: '8px', color: '#666' }}>
                Processing records... This may take a while for large files.
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            backgroundColor: '#ffebee',
            color: '#c62828',
            padding: '12px',
            borderRadius: '4px',
            marginBottom: '20px',
          }}>
            {error}
          </div>
        )}

        {/* Result */}
        {result && (
          <div style={{
            backgroundColor: result.success ? '#e8f5e9' : '#fff3e0',
            padding: '16px',
            borderRadius: '4px',
            marginBottom: '20px',
          }}>
            <h4 style={{ margin: '0 0 12px 0', color: result.success ? '#2e7d32' : '#ef6c00' }}>
              {result.success ? 'Import Successful' : 'Import Completed with Errors'}
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
              <div><strong>Records Processed:</strong> {result.recordsProcessed.toLocaleString()}</div>
              <div><strong>Records Failed:</strong> {result.recordsFailed.toLocaleString()}</div>
              <div><strong>Duration:</strong> {formatDuration(result.duration)}</div>
              <div><strong>Format:</strong> {result.format}</div>
            </div>

            {result.errors.length > 0 && (
              <div style={{ marginTop: '12px' }}>
                <strong>Errors ({result.errors.length}):</strong>
                <div style={{
                  maxHeight: '100px',
                  overflow: 'auto',
                  backgroundColor: '#fff',
                  padding: '8px',
                  borderRadius: '4px',
                  marginTop: '4px',
                  fontSize: '12px',
                }}>
                  {result.errors.slice(0, 10).map((err, i) => (
                    <div key={i} style={{ color: '#c62828' }}>{err}</div>
                  ))}
                  {result.errors.length > 10 && (
                    <div style={{ color: '#666' }}>...and {result.errors.length - 10} more</div>
                  )}
                </div>
              </div>
            )}

            <div style={{ marginTop: '12px', fontSize: '14px', color: '#666' }}>
              Data imported to: <code>{tableName}_toprocess</code>
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          {file && !isUploading && !result && (
            <button
              onClick={handleAnalyze}
              disabled={isAnalyzing}
              style={{
                padding: '10px 20px',
                backgroundColor: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: isAnalyzing ? 'not-allowed' : 'pointer',
              }}
            >
              {isAnalyzing ? 'Analyzing...' : 'Analyze File'}
            </button>
          )}

          <button
            onClick={handleImport}
            disabled={!file || !tableName || isUploading || !!result}
            style={{
              padding: '10px 24px',
              backgroundColor: (!file || !tableName || isUploading || !!result) ? '#ccc' : '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: (!file || !tableName || isUploading || !!result) ? 'not-allowed' : 'pointer',
              fontWeight: 'bold',
            }}
          >
            {isUploading ? 'Importing...' : 'Import File'}
          </button>

          {result && (
            <button
              onClick={() => {
                setFile(null);
                setResult(null);
                setAnalysis(null);
                setError(null);
              }}
              style={{
                padding: '10px 20px',
                backgroundColor: '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Import Another
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default FileImporter;
