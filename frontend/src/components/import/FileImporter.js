import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState, useRef, useCallback } from 'react';
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';
export const FileImporter = ({ onImportComplete, onClose }) => {
    const [file, setFile] = useState(null);
    const [tableName, setTableName] = useState('');
    const [format, setFormat] = useState('auto');
    const [batchSize, setBatchSize] = useState(500);
    const [rootElement, setRootElement] = useState('');
    const [idField, setIdField] = useState('');
    const [isUploading, setIsUploading] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [result, setResult] = useState(null);
    const [analysis, setAnalysis] = useState(null);
    const [error, setError] = useState(null);
    const [formats, setFormats] = useState([]);
    const [dragActive, setDragActive] = useState(false);
    const fileInputRef = useRef(null);
    // Fetch supported formats on mount
    React.useEffect(() => {
        fetch(`${API_BASE}/api/import/formats`)
            .then(res => res.json())
            .then(data => setFormats(data.formats || []))
            .catch(err => console.error('Failed to fetch formats:', err));
    }, []);
    const handleDrag = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') {
            setDragActive(true);
        }
        else if (e.type === 'dragleave') {
            setDragActive(false);
        }
    }, []);
    const handleDrop = useCallback((e) => {
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
            }
            else if (name.includes('takeout') || name.includes('activity') || name.includes('history')) {
                setFormat('google-takeout');
            }
            else if (name.includes('chat') || name.includes('message') || name.includes('transcript')) {
                setFormat('chat-transcript');
            }
            else {
                setFormat('auto');
            }
            // Suggest table name from filename
            const baseName = droppedFile.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
            if (!tableName) {
                setTableName(baseName);
            }
        }
    }, [tableName]);
    const handleFileChange = (e) => {
        if (e.target.files && e.target.files[0]) {
            const selectedFile = e.target.files[0];
            setFile(selectedFile);
            // Auto-detect format from filename
            const name = selectedFile.name.toLowerCase();
            if (name.endsWith('.xml')) {
                setFormat('xml');
            }
            else if (name.includes('takeout') || name.includes('activity') || name.includes('history')) {
                setFormat('google-takeout');
            }
            else if (name.includes('chat') || name.includes('message') || name.includes('transcript')) {
                setFormat('chat-transcript');
            }
            else {
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
        if (!file)
            return;
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
        }
        catch (err) {
            setError(err.message || 'Analysis failed');
        }
        finally {
            setIsAnalyzing(false);
        }
    };
    const handleImport = async () => {
        if (!file || !tableName)
            return;
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
            const response = await new Promise((resolve, reject) => {
                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve(JSON.parse(xhr.responseText));
                    }
                    else {
                        try {
                            const error = JSON.parse(xhr.responseText);
                            reject(new Error(error.message || error.error || 'Import failed'));
                        }
                        catch {
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
        }
        catch (err) {
            setError(err.message || 'Import failed');
        }
        finally {
            setIsUploading(false);
        }
    };
    const formatFileSize = (bytes) => {
        if (bytes < 1024)
            return `${bytes} B`;
        if (bytes < 1024 * 1024)
            return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024)
            return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    };
    const formatDuration = (ms) => {
        if (ms < 1000)
            return `${ms}ms`;
        if (ms < 60000)
            return `${(ms / 1000).toFixed(1)}s`;
        return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
    };
    return (_jsx("div", { style: {
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
        }, children: _jsxs("div", { style: {
                backgroundColor: 'white',
                borderRadius: '8px',
                padding: '24px',
                maxWidth: '800px',
                width: '90%',
                maxHeight: '90vh',
                overflow: 'auto',
                boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }, children: [_jsx("h2", { style: { margin: 0 }, children: "Import File" }), onClose && (_jsx("button", { onClick: onClose, style: {
                                background: 'none',
                                border: 'none',
                                fontSize: '24px',
                                cursor: 'pointer',
                                color: '#666',
                            }, children: "x" }))] }), _jsxs("div", { onDragEnter: handleDrag, onDragLeave: handleDrag, onDragOver: handleDrag, onDrop: handleDrop, onClick: () => fileInputRef.current?.click(), style: {
                        border: `2px dashed ${dragActive ? '#007bff' : '#ccc'}`,
                        borderRadius: '8px',
                        padding: '40px',
                        textAlign: 'center',
                        backgroundColor: dragActive ? '#f0f7ff' : '#fafafa',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        marginBottom: '20px',
                    }, children: [_jsx("input", { ref: fileInputRef, type: "file", accept: ".json,.xml", onChange: handleFileChange, style: { display: 'none' } }), file ? (_jsxs("div", { children: [_jsx("div", { style: { fontSize: '48px', marginBottom: '10px' }, children: file.name.endsWith('.xml') ? 'XML' : 'JSON' }), _jsx("div", { style: { fontWeight: 'bold', fontSize: '18px' }, children: file.name }), _jsx("div", { style: { color: '#666', marginTop: '5px' }, children: formatFileSize(file.size) }), _jsx("div", { style: { color: '#007bff', marginTop: '10px', fontSize: '14px' }, children: "Click or drop to change file" })] })) : (_jsxs("div", { children: [_jsx("div", { style: { fontSize: '48px', marginBottom: '10px', opacity: 0.5 }, children: "+" }), _jsx("div", { style: { fontSize: '18px', color: '#666' }, children: "Drop your file here or click to browse" }), _jsx("div", { style: { color: '#999', marginTop: '10px', fontSize: '14px' }, children: "Supports JSON, XML, Google Takeout, Chat Transcripts (up to 5GB)" })] }))] }), file && (_jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }, children: [_jsxs("div", { children: [_jsx("label", { style: { display: 'block', marginBottom: '4px', fontWeight: 'bold' }, children: "Table Name *" }), _jsx("input", { type: "text", value: tableName, onChange: (e) => setTableName(e.target.value.replace(/[^a-zA-Z0-9_]/g, '_')), placeholder: "my_data", style: {
                                        width: '100%',
                                        padding: '8px 12px',
                                        borderRadius: '4px',
                                        border: '1px solid #ccc',
                                        boxSizing: 'border-box',
                                    } }), _jsxs("div", { style: { fontSize: '12px', color: '#666', marginTop: '4px' }, children: ["Data will be imported to ", tableName || 'table', "_toprocess"] })] }), _jsxs("div", { children: [_jsx("label", { style: { display: 'block', marginBottom: '4px', fontWeight: 'bold' }, children: "Format" }), _jsxs("select", { value: format, onChange: (e) => setFormat(e.target.value), style: {
                                        width: '100%',
                                        padding: '8px 12px',
                                        borderRadius: '4px',
                                        border: '1px solid #ccc',
                                        boxSizing: 'border-box',
                                    }, children: [_jsx("option", { value: "auto", children: "Auto-detect" }), _jsx("option", { value: "json", children: "JSON (Standard)" }), _jsx("option", { value: "xml", children: "XML (Streaming)" }), _jsx("option", { value: "google-takeout", children: "Google Takeout" }), _jsx("option", { value: "chat-transcript", children: "Chat Transcript" })] })] }), _jsxs("div", { children: [_jsx("label", { style: { display: 'block', marginBottom: '4px', fontWeight: 'bold' }, children: "Batch Size" }), _jsx("input", { type: "number", value: batchSize, onChange: (e) => setBatchSize(parseInt(e.target.value) || 500), min: 1, max: 10000, style: {
                                        width: '100%',
                                        padding: '8px 12px',
                                        borderRadius: '4px',
                                        border: '1px solid #ccc',
                                        boxSizing: 'border-box',
                                    } }), _jsx("div", { style: { fontSize: '12px', color: '#666', marginTop: '4px' }, children: "Records per database batch (lower = less memory)" })] }), _jsxs("div", { children: [_jsx("label", { style: { display: 'block', marginBottom: '4px', fontWeight: 'bold' }, children: "ID Field (optional)" }), _jsx("input", { type: "text", value: idField, onChange: (e) => setIdField(e.target.value), placeholder: "e.g., _id or data.id", style: {
                                        width: '100%',
                                        padding: '8px 12px',
                                        borderRadius: '4px',
                                        border: '1px solid #ccc',
                                        boxSizing: 'border-box',
                                    } })] }), format === 'xml' && (_jsxs("div", { style: { gridColumn: '1 / -1' }, children: [_jsx("label", { style: { display: 'block', marginBottom: '4px', fontWeight: 'bold' }, children: "Root Element (for XML)" }), _jsx("input", { type: "text", value: rootElement, onChange: (e) => setRootElement(e.target.value), placeholder: "e.g., item, record, row", style: {
                                        width: '100%',
                                        padding: '8px 12px',
                                        borderRadius: '4px',
                                        border: '1px solid #ccc',
                                        boxSizing: 'border-box',
                                    } }), _jsx("div", { style: { fontSize: '12px', color: '#666', marginTop: '4px' }, children: "Which XML element represents each record (default: auto-detect)" })] }))] })), format !== 'auto' && formats.length > 0 && (_jsx("div", { style: {
                        backgroundColor: '#f8f9fa',
                        padding: '12px',
                        borderRadius: '4px',
                        marginBottom: '20px',
                        fontSize: '14px',
                    }, children: formats.find(f => f.format === format)?.description })), analysis && (_jsxs("div", { style: {
                        backgroundColor: '#e8f5e9',
                        padding: '16px',
                        borderRadius: '4px',
                        marginBottom: '20px',
                    }, children: [_jsx("h4", { style: { margin: '0 0 12px 0' }, children: "File Analysis" }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '12px' }, children: [_jsxs("div", { children: [_jsx("strong", { children: "Format:" }), " ", analysis.detectedFormat] }), _jsxs("div", { children: [_jsx("strong", { children: "Records:" }), " ~", analysis.estimatedTotalRecords] }), _jsxs("div", { children: [_jsx("strong", { children: "Fields:" }), " ", analysis.fields.length] })] }), analysis.fields.length > 0 && (_jsxs("div", { children: [_jsx("strong", { children: "Detected Fields:" }), _jsxs("div", { style: {
                                        maxHeight: '100px',
                                        overflow: 'auto',
                                        backgroundColor: 'white',
                                        padding: '8px',
                                        borderRadius: '4px',
                                        marginTop: '8px',
                                        fontSize: '12px',
                                        fontFamily: 'monospace',
                                    }, children: [analysis.fields.slice(0, 20).map((f, i) => (_jsxs("div", { children: [f.path, " (", f.types.join(', '), ")"] }, i))), analysis.fields.length > 20 && (_jsxs("div", { style: { color: '#666' }, children: ["...and ", analysis.fields.length - 20, " more"] }))] })] }))] })), isUploading && (_jsxs("div", { style: { marginBottom: '20px' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }, children: [_jsx("span", { children: "Uploading..." }), _jsxs("span", { children: [uploadProgress, "%"] })] }), _jsx("div", { style: {
                                height: '8px',
                                backgroundColor: '#e0e0e0',
                                borderRadius: '4px',
                                overflow: 'hidden',
                            }, children: _jsx("div", { style: {
                                    height: '100%',
                                    width: `${uploadProgress}%`,
                                    backgroundColor: '#007bff',
                                    transition: 'width 0.3s',
                                } }) }), uploadProgress === 100 && (_jsx("div", { style: { marginTop: '8px', color: '#666' }, children: "Processing records... This may take a while for large files." }))] })), error && (_jsx("div", { style: {
                        backgroundColor: '#ffebee',
                        color: '#c62828',
                        padding: '12px',
                        borderRadius: '4px',
                        marginBottom: '20px',
                    }, children: error })), result && (_jsxs("div", { style: {
                        backgroundColor: result.success ? '#e8f5e9' : '#fff3e0',
                        padding: '16px',
                        borderRadius: '4px',
                        marginBottom: '20px',
                    }, children: [_jsx("h4", { style: { margin: '0 0 12px 0', color: result.success ? '#2e7d32' : '#ef6c00' }, children: result.success ? 'Import Successful' : 'Import Completed with Errors' }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }, children: [_jsxs("div", { children: [_jsx("strong", { children: "Records Processed:" }), " ", result.recordsProcessed.toLocaleString()] }), _jsxs("div", { children: [_jsx("strong", { children: "Records Failed:" }), " ", result.recordsFailed.toLocaleString()] }), _jsxs("div", { children: [_jsx("strong", { children: "Duration:" }), " ", formatDuration(result.duration)] }), _jsxs("div", { children: [_jsx("strong", { children: "Format:" }), " ", result.format] })] }), result.errors.length > 0 && (_jsxs("div", { style: { marginTop: '12px' }, children: [_jsxs("strong", { children: ["Errors (", result.errors.length, "):"] }), _jsxs("div", { style: {
                                        maxHeight: '100px',
                                        overflow: 'auto',
                                        backgroundColor: '#fff',
                                        padding: '8px',
                                        borderRadius: '4px',
                                        marginTop: '4px',
                                        fontSize: '12px',
                                    }, children: [result.errors.slice(0, 10).map((err, i) => (_jsx("div", { style: { color: '#c62828' }, children: err }, i))), result.errors.length > 10 && (_jsxs("div", { style: { color: '#666' }, children: ["...and ", result.errors.length - 10, " more"] }))] })] })), _jsxs("div", { style: { marginTop: '12px', fontSize: '14px', color: '#666' }, children: ["Data imported to: ", _jsxs("code", { children: [tableName, "_toprocess"] })] })] })), _jsxs("div", { style: { display: 'flex', gap: '10px', justifyContent: 'flex-end' }, children: [file && !isUploading && !result && (_jsx("button", { onClick: handleAnalyze, disabled: isAnalyzing, style: {
                                padding: '10px 20px',
                                backgroundColor: '#6c757d',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: isAnalyzing ? 'not-allowed' : 'pointer',
                            }, children: isAnalyzing ? 'Analyzing...' : 'Analyze File' })), _jsx("button", { onClick: handleImport, disabled: !file || !tableName || isUploading || !!result, style: {
                                padding: '10px 24px',
                                backgroundColor: (!file || !tableName || isUploading || !!result) ? '#ccc' : '#28a745',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: (!file || !tableName || isUploading || !!result) ? 'not-allowed' : 'pointer',
                                fontWeight: 'bold',
                            }, children: isUploading ? 'Importing...' : 'Import File' }), result && (_jsx("button", { onClick: () => {
                                setFile(null);
                                setResult(null);
                                setAnalysis(null);
                                setError(null);
                            }, style: {
                                padding: '10px 20px',
                                backgroundColor: '#007bff',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                            }, children: "Import Another" }))] })] }) }));
};
export default FileImporter;
