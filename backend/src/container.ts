import 'reflect-metadata';
import dotenv from 'dotenv';
import { container } from 'tsyringe';
import { DatabaseConnection } from './database/connection.js';
import { AnalysisService } from './services/analysisService.js';
import { ExecutionService } from './services/executionService.js';
import { FilterPresetService } from './services/filterPresetService.js';
import { MappingConfigService } from './services/mappingConfigService.js';
import { TableService } from './services/tableService.js';

// Load environment variables first
dotenv.config();

// Database configuration from environment
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME || 'test_json'
};

console.log('DB Config:', {
  host: dbConfig.host,
  port: dbConfig.port,
  user: dbConfig.user,
  database: dbConfig.database
});

// Create and register DatabaseConnection instance
const dbConnection = new DatabaseConnection(dbConfig);
container.registerInstance(DatabaseConnection, dbConnection);

// Register services - they will automatically receive DatabaseConnection via constructor injection
container.registerSingleton(AnalysisService, AnalysisService);
container.registerSingleton(ExecutionService, ExecutionService);
container.registerSingleton(FilterPresetService, FilterPresetService);
container.registerSingleton(MappingConfigService, MappingConfigService);
container.registerSingleton(TableService, TableService);

export { container };
