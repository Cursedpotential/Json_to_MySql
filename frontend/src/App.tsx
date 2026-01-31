import React, { useState } from 'react';
import { JsonAnalyzerComponent } from './components/analysis/JsonAnalyzerComponent';
import { AnalysisResults } from './components/analysis/AnalysisResults';
import { TableSelector } from './components/mapping/TableSelector';
import { DragDropMapper } from './components/mapping/DragDropMapper';
import { RelationshipEditor } from './components/mapping/RelationshipEditor';
import { SqlGenerator } from './components/mapping/SqlGenerator';
import { SaveLoadConfig } from './components/mapping/SaveLoadConfig';
import { StagingWorkflow } from './components/staging/StagingWorkflow';
import { FileImporter } from './components/import/FileImporter';
import { SchemaAnalysis, TableDefinition, FieldMapping, TableRelationship } from './types';

type Step = 'analyze' | 'select-tables' | 'map-fields' | 'define-relationships' | 'generate-sql';

export const App: React.FC = () => {
  const [currentStep, setCurrentStep] = useState<Step>('analyze');
  const [analysis, setAnalysis] = useState<SchemaAnalysis | null>(null);
  const [metadata, setMetadata] = useState<any>(null);
  const [selectedTables, setSelectedTables] = useState<TableDefinition[]>([]);
  const [mappings, setMappings] = useState<FieldMapping[]>([]);
  const [relationships, setRelationships] = useState<TableRelationship[]>([]);
  const [executionCompleted, setExecutionCompleted] = useState(false);
  const [showStaging, setShowStaging] = useState(false);
  const [showImporter, setShowImporter] = useState(false);

  const handleAnalysisComplete = (analysisResult: SchemaAnalysis, meta: any) => {
    setAnalysis(analysisResult);
    setMetadata(meta);
    setCurrentStep('select-tables');
  };

  const handleTablesSelected = (tables: TableDefinition[], loadedConfig?: any) => {
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

  const handleLoadConfig = (config: any) => {
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

  const handleExecutionComplete = (result: any) => {
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

  return (
    <div style={{ 
      maxWidth: '1600px', 
      margin: '0 auto',
      padding: '20px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1 style={{
          borderBottom: '2px solid #007bff',
          paddingBottom: '10px',
          margin: 0,
        }}>
          JSON to SQL Flattener
        </h1>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            onClick={() => setShowImporter(true)}
            style={{
              padding: '10px 20px',
              backgroundColor: '#17a2b8',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 'bold',
            }}
          >
            Import File
          </button>
          <button
            onClick={handleOpenStaging}
            style={{
              padding: '10px 20px',
              backgroundColor: '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 'bold',
            }}
          >
            Stage Data
          </button>

          {(['map-fields', 'define-relationships', 'generate-sql'].includes(currentStep)) && mappings.length > 0 && (
            <SaveLoadConfig
              currentConfig={getCurrentConfig()}
              onLoad={handleLoadConfig}
            />
          )}
        </div>
      </div>

      {/* Progress Indicator */}
      <div style={{ marginBottom: '30px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{
          padding: '8px 16px',
          backgroundColor: currentStep === 'analyze' ? '#007bff' : '#28a745',
          color: 'white',
          borderRadius: '4px',
          fontSize: '14px',
        }}>
          {currentStep === 'analyze' ? '1. Analyzing...' : '✓ 1. Analyzed'}
        </div>
        <div style={{ width: '20px', height: '2px', backgroundColor: '#dee2e6' }} />
        <div style={{
          padding: '8px 16px',
          backgroundColor: currentStep === 'select-tables' ? '#007bff' : (currentStep === 'analyze' ? '#dee2e6' : '#28a745'),
          color: currentStep === 'analyze' ? '#6c757d' : 'white',
          borderRadius: '4px',
          fontSize: '14px',
        }}>
          {currentStep === 'select-tables' ? '2. Selecting...' : (currentStep === 'analyze' ? '2. Tables' : '✓ 2. Tables')}
        </div>
        <div style={{ width: '20px', height: '2px', backgroundColor: '#dee2e6' }} />
        <div style={{
          padding: '8px 16px',
          backgroundColor: currentStep === 'map-fields' ? '#007bff' : (['analyze', 'select-tables'].includes(currentStep) ? '#dee2e6' : '#28a745'),
          color: ['analyze', 'select-tables'].includes(currentStep) ? '#6c757d' : 'white',
          borderRadius: '4px',
          fontSize: '14px',
        }}>
          {currentStep === 'map-fields' ? '3. Mapping...' : (['analyze', 'select-tables'].includes(currentStep) ? '3. Map' : '✓ 3. Mapped')}
        </div>
        <div style={{ width: '20px', height: '2px', backgroundColor: '#dee2e6' }} />
        <div style={{
          padding: '8px 16px',
          backgroundColor: currentStep === 'define-relationships' ? '#007bff' : (['analyze', 'select-tables', 'map-fields'].includes(currentStep) ? '#dee2e6' : '#28a745'),
          color: ['analyze', 'select-tables', 'map-fields'].includes(currentStep) ? '#6c757d' : 'white',
          borderRadius: '4px',
          fontSize: '14px',
        }}>
          {currentStep === 'define-relationships' ? '4. Relationships...' : (['analyze', 'select-tables', 'map-fields'].includes(currentStep) ? '4. Relations' : '✓ 4. Relations')}
        </div>
        <div style={{ width: '20px', height: '2px', backgroundColor: '#dee2e6' }} />
        <div style={{
          padding: '8px 16px',
          backgroundColor: currentStep === 'generate-sql' ? '#007bff' : '#dee2e6',
          color: currentStep === 'generate-sql' ? 'white' : '#6c757d',
          borderRadius: '4px',
          fontSize: '14px',
        }}>
          5. Execute
        </div>
      </div>

      {currentStep === 'analyze' && (
        <JsonAnalyzerComponent onAnalysisComplete={handleAnalysisComplete} />
      )}

      {currentStep === 'select-tables' && analysis && metadata && (
        <div>
          <AnalysisResults analysis={analysis} metadata={metadata} />
          <div style={{ marginTop: '30px' }}>
            <TableSelector
              suggestedTables={suggestedTables}
              fields={analysis.fields}
              baseTableName={metadata.baseTableName}
              onTablesSelected={handleTablesSelected}
            />
          </div>
          <button
            onClick={() => setCurrentStep('analyze')}
            style={{
              marginTop: '20px',
              padding: '10px 20px',
              backgroundColor: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            ← Back to Analysis
          </button>
        </div>
      )}

      {currentStep === 'map-fields' && (
        <div>
          <h2>Map Fields to Tables</h2>
          <p style={{ color: '#666' }}>
            Drag JSON fields from the left and drop them onto table columns on the right.
          </p>
          
          <DragDropMapper
            fields={analysis?.fields || []}
            tables={selectedTables}
            onMappingsChange={setMappings}
            initialMappings={mappings}
            baseTableName={metadata?.baseTableName}
          />

          <div style={{ marginTop: '30px', display: 'flex', gap: '10px' }}>
            <button
              onClick={() => setCurrentStep('select-tables')}
              style={{
                padding: '10px 20px',
                backgroundColor: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              ← Back to Table Selection
            </button>
            <button
              onClick={handleMappingsComplete}
              disabled={mappings.length === 0}
              style={{
                padding: '10px 20px',
                backgroundColor: mappings.length > 0 ? '#28a745' : '#ccc',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: mappings.length > 0 ? 'pointer' : 'not-allowed',
                fontWeight: 'bold',
              }}
            >
              Continue to Relationships →
            </button>
          </div>
        </div>
      )}

      {currentStep === 'define-relationships' && (
        <div>
          <h2>Define Table Relationships</h2>
          <p style={{ color: '#666' }}>
            Configure parent-child relationships for proper insert order and foreign key handling.
          </p>

          <RelationshipEditor
            tables={selectedTables}
            relationships={relationships}
            onRelationshipsChange={setRelationships}
          />

          <div style={{ marginTop: '30px', display: 'flex', gap: '10px' }}>
            <button
              onClick={() => setCurrentStep('map-fields')}
              style={{
                padding: '10px 20px',
                backgroundColor: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              ← Back to Mapping
            </button>
            <button
              onClick={handleRelationshipsComplete}
              style={{
                padding: '10px 20px',
                backgroundColor: '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 'bold',
              }}
            >
              Continue to Execute →
            </button>
          </div>
        </div>
      )}

      {currentStep === 'generate-sql' && metadata && (
        <div>
          <h2>Execute Flattening Process</h2>
          
          <SqlGenerator
            tables={selectedTables}
            mappings={mappings}
            baseTableName={metadata.baseTableName}
            whereConditions={metadata.appliedFilters}
            relationships={relationships}
            onExecutionComplete={handleExecutionComplete}
          />

          <div style={{ marginTop: '30px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button
              onClick={() => setCurrentStep('define-relationships')}
              style={{
                padding: '10px 20px',
                backgroundColor: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              ← Back to Relationships
            </button>
            {executionCompleted && (
              <button
                onClick={handleOpenStaging}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '16px',
                }}
              >
                📦 Stage Data
              </button>
            )}
            <button
              onClick={handleStartOver}
              style={{
                padding: '10px 20px',
                backgroundColor: '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 'bold',
              }}
            >
              🔄 Start New Analysis
            </button>
          </div>
        </div>
      )}

      {/* Staging Workflow Modal */}
      {showStaging && (
        <StagingWorkflow
          sourceTables={selectedTables}
          onClose={handleCloseStaging}
        />
      )}

      {/* File Import Modal */}
      {showImporter && (
        <FileImporter
          onClose={() => setShowImporter(false)}
          onImportComplete={(result) => {
            console.log('Import complete:', result);
          }}
        />
      )}
    </div>
  );
};
