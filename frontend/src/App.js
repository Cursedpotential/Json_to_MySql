import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { JsonAnalyzerComponent } from './components/analysis/JsonAnalyzerComponent';
import { AnalysisResults } from './components/analysis/AnalysisResults';
import { TableSelector } from './components/mapping/TableSelector';
import { DragDropMapper } from './components/mapping/DragDropMapper';
import { RelationshipEditor } from './components/mapping/RelationshipEditor';
import { SqlGenerator } from './components/mapping/SqlGenerator';
import { SaveLoadConfig } from './components/mapping/SaveLoadConfig';
import { StagingWorkflow } from './components/staging/StagingWorkflow';
import { FileImporter } from './components/import/FileImporter';
export const App = () => {
    const [currentStep, setCurrentStep] = useState('analyze');
    const [analysis, setAnalysis] = useState(null);
    const [metadata, setMetadata] = useState(null);
    const [selectedTables, setSelectedTables] = useState([]);
    const [mappings, setMappings] = useState([]);
    const [relationships, setRelationships] = useState([]);
    const [executionCompleted, setExecutionCompleted] = useState(false);
    const [showStaging, setShowStaging] = useState(false);
    const [showImporter, setShowImporter] = useState(false);
    const handleAnalysisComplete = (analysisResult, meta) => {
        setAnalysis(analysisResult);
        setMetadata(meta);
        setCurrentStep('select-tables');
    };
    const handleTablesSelected = (tables, loadedConfig) => {
        setSelectedTables(tables);
        if (loadedConfig && loadedConfig.mappings) {
            setMappings(loadedConfig.mappings);
            setRelationships(loadedConfig.relationships || []);
        }
        setCurrentStep('map-fields');
    };
    const handleMappingsComplete = () => {
        setCurrentStep('define-relationships');
    };
    const handleRelationshipsComplete = () => {
        setCurrentStep('generate-sql');
    };
    const handleLoadConfig = (config) => {
        // Restore metadata
        setMetadata({
            baseTableName: config.baseTableName,
            toProcessTable: `${config.baseTableName}_toprocess`,
            appliedFilters: config.whereConditions,
        });
        // Restore analysis with fields so DragDropMapper can display them
        if (config.fields && config.fields.length > 0) {
            setAnalysis({
                fields: config.fields,
                totalRecords: 0,
                nestedStructures: [],
            });
        }
        setSelectedTables(config.tables);
        setMappings(config.mappings);
        setRelationships(config.relationships || []);
        setCurrentStep('map-fields');
    };
    const handleStartOver = () => {
        setCurrentStep('analyze');
        setAnalysis(null);
        setMetadata(null);
        setSelectedTables([]);
        setMappings([]);
        setRelationships([]);
        setExecutionCompleted(false);
        setShowStaging(false);
    };
    const handleExecutionComplete = (result) => {
        setExecutionCompleted(true);
    };
    const handleOpenStaging = () => {
        setShowStaging(true);
    };
    const handleCloseStaging = () => {
        setShowStaging(false);
    };
    const suggestedTables = analysis
        ? Array.from(new Set(analysis.fields.map(f => f.suggestedTable)))
        : [];
    const getCurrentConfig = () => ({
        baseTableName: metadata?.baseTableName || '',
        whereConditions: metadata?.appliedFilters || [],
        tables: selectedTables,
        mappings,
        fields: analysis?.fields || [],
        relationships,
    });
    return (_jsxs("div", { style: {
            maxWidth: '1600px',
            margin: '0 auto',
            padding: '20px',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }, children: [_jsx("h1", { style: {
                            borderBottom: '2px solid #007bff',
                            paddingBottom: '10px',
                            margin: 0,
                        }, children: "JSON to SQL Flattener" }), _jsxs("div", { style: { display: 'flex', gap: '10px', alignItems: 'center' }, children: [_jsx("button", { onClick: () => setShowImporter(true), style: {
                                    padding: '10px 20px',
                                    backgroundColor: '#17a2b8',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontWeight: 'bold',
                                }, children: "Import File" }), _jsx("button", { onClick: handleOpenStaging, style: {
                                    padding: '10px 20px',
                                    backgroundColor: '#28a745',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontWeight: 'bold',
                                }, children: "Stage Data" }), (['map-fields', 'define-relationships', 'generate-sql'].includes(currentStep)) && mappings.length > 0 && (_jsx(SaveLoadConfig, { currentConfig: getCurrentConfig(), onLoad: handleLoadConfig }))] })] }), _jsxs("div", { style: { marginBottom: '30px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }, children: [_jsx("div", { style: {
                            padding: '8px 16px',
                            backgroundColor: currentStep === 'analyze' ? '#007bff' : '#28a745',
                            color: 'white',
                            borderRadius: '4px',
                            fontSize: '14px',
                        }, children: currentStep === 'analyze' ? '1. Analyzing...' : '✓ 1. Analyzed' }), _jsx("div", { style: { width: '20px', height: '2px', backgroundColor: '#dee2e6' } }), _jsx("div", { style: {
                            padding: '8px 16px',
                            backgroundColor: currentStep === 'select-tables' ? '#007bff' : (currentStep === 'analyze' ? '#dee2e6' : '#28a745'),
                            color: currentStep === 'analyze' ? '#6c757d' : 'white',
                            borderRadius: '4px',
                            fontSize: '14px',
                        }, children: currentStep === 'select-tables' ? '2. Selecting...' : (currentStep === 'analyze' ? '2. Tables' : '✓ 2. Tables') }), _jsx("div", { style: { width: '20px', height: '2px', backgroundColor: '#dee2e6' } }), _jsx("div", { style: {
                            padding: '8px 16px',
                            backgroundColor: currentStep === 'map-fields' ? '#007bff' : (['analyze', 'select-tables'].includes(currentStep) ? '#dee2e6' : '#28a745'),
                            color: ['analyze', 'select-tables'].includes(currentStep) ? '#6c757d' : 'white',
                            borderRadius: '4px',
                            fontSize: '14px',
                        }, children: currentStep === 'map-fields' ? '3. Mapping...' : (['analyze', 'select-tables'].includes(currentStep) ? '3. Map' : '✓ 3. Mapped') }), _jsx("div", { style: { width: '20px', height: '2px', backgroundColor: '#dee2e6' } }), _jsx("div", { style: {
                            padding: '8px 16px',
                            backgroundColor: currentStep === 'define-relationships' ? '#007bff' : (['analyze', 'select-tables', 'map-fields'].includes(currentStep) ? '#dee2e6' : '#28a745'),
                            color: ['analyze', 'select-tables', 'map-fields'].includes(currentStep) ? '#6c757d' : 'white',
                            borderRadius: '4px',
                            fontSize: '14px',
                        }, children: currentStep === 'define-relationships' ? '4. Relationships...' : (['analyze', 'select-tables', 'map-fields'].includes(currentStep) ? '4. Relations' : '✓ 4. Relations') }), _jsx("div", { style: { width: '20px', height: '2px', backgroundColor: '#dee2e6' } }), _jsx("div", { style: {
                            padding: '8px 16px',
                            backgroundColor: currentStep === 'generate-sql' ? '#007bff' : '#dee2e6',
                            color: currentStep === 'generate-sql' ? 'white' : '#6c757d',
                            borderRadius: '4px',
                            fontSize: '14px',
                        }, children: "5. Execute" })] }), currentStep === 'analyze' && (_jsx(JsonAnalyzerComponent, { onAnalysisComplete: handleAnalysisComplete })), currentStep === 'select-tables' && analysis && metadata && (_jsxs("div", { children: [_jsx(AnalysisResults, { analysis: analysis, metadata: metadata }), _jsx("div", { style: { marginTop: '30px' }, children: _jsx(TableSelector, { suggestedTables: suggestedTables, fields: analysis.fields, baseTableName: metadata.baseTableName, onTablesSelected: handleTablesSelected }) }), _jsx("button", { onClick: () => setCurrentStep('analyze'), style: {
                            marginTop: '20px',
                            padding: '10px 20px',
                            backgroundColor: '#6c757d',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                        }, children: "\u2190 Back to Analysis" })] })), currentStep === 'map-fields' && (_jsxs("div", { children: [_jsx("h2", { children: "Map Fields to Tables" }), _jsx("p", { style: { color: '#666' }, children: "Drag JSON fields from the left and drop them onto table columns on the right." }), _jsx(DragDropMapper, { fields: analysis?.fields || [], tables: selectedTables, onMappingsChange: setMappings, initialMappings: mappings, baseTableName: metadata?.baseTableName }), _jsxs("div", { style: { marginTop: '30px', display: 'flex', gap: '10px' }, children: [_jsx("button", { onClick: () => setCurrentStep('select-tables'), style: {
                                    padding: '10px 20px',
                                    backgroundColor: '#6c757d',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                }, children: "\u2190 Back to Table Selection" }), _jsx("button", { onClick: handleMappingsComplete, disabled: mappings.length === 0, style: {
                                    padding: '10px 20px',
                                    backgroundColor: mappings.length > 0 ? '#28a745' : '#ccc',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: mappings.length > 0 ? 'pointer' : 'not-allowed',
                                    fontWeight: 'bold',
                                }, children: "Continue to Relationships \u2192" })] })] })), currentStep === 'define-relationships' && (_jsxs("div", { children: [_jsx("h2", { children: "Define Table Relationships" }), _jsx("p", { style: { color: '#666' }, children: "Configure parent-child relationships for proper insert order and foreign key handling." }), _jsx(RelationshipEditor, { tables: selectedTables, relationships: relationships, onRelationshipsChange: setRelationships }), _jsxs("div", { style: { marginTop: '30px', display: 'flex', gap: '10px' }, children: [_jsx("button", { onClick: () => setCurrentStep('map-fields'), style: {
                                    padding: '10px 20px',
                                    backgroundColor: '#6c757d',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                }, children: "\u2190 Back to Mapping" }), _jsx("button", { onClick: handleRelationshipsComplete, style: {
                                    padding: '10px 20px',
                                    backgroundColor: '#28a745',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontWeight: 'bold',
                                }, children: "Continue to Execute \u2192" })] })] })), currentStep === 'generate-sql' && metadata && (_jsxs("div", { children: [_jsx("h2", { children: "Execute Flattening Process" }), _jsx(SqlGenerator, { tables: selectedTables, mappings: mappings, baseTableName: metadata.baseTableName, whereConditions: metadata.appliedFilters, relationships: relationships, onExecutionComplete: handleExecutionComplete }), _jsxs("div", { style: { marginTop: '30px', display: 'flex', gap: '10px', flexWrap: 'wrap' }, children: [_jsx("button", { onClick: () => setCurrentStep('define-relationships'), style: {
                                    padding: '10px 20px',
                                    backgroundColor: '#6c757d',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                }, children: "\u2190 Back to Relationships" }), executionCompleted && (_jsx("button", { onClick: handleOpenStaging, style: {
                                    padding: '12px 24px',
                                    backgroundColor: '#28a745',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontWeight: 'bold',
                                    fontSize: '16px',
                                }, children: "\uD83D\uDCE6 Stage Data" })), _jsx("button", { onClick: handleStartOver, style: {
                                    padding: '10px 20px',
                                    backgroundColor: '#007bff',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontWeight: 'bold',
                                }, children: "\uD83D\uDD04 Start New Analysis" })] })] })), showStaging && (_jsx(StagingWorkflow, { sourceTables: selectedTables, onClose: handleCloseStaging })), showImporter && (_jsx(FileImporter, { onClose: () => setShowImporter(false), onImportComplete: (result) => {
                    console.log('Import complete:', result);
                } }))] }));
};
