/**
 * Environment Configuration
 * 
 * Centralized environment variable loading and validation
 * Loads from root directory environment files consistently across all services
 */

import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Define the environment schema for validation
const environmentSchema = z.object({
  // Node environment
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  
  // Server configuration
  PORT: z.string().default('3001').transform(Number),
  HOST: z.string().default('0.0.0.0'),
  API_PREFIX: z.string().default('/api'),
  API_VERSION: z.string().default('v1'),
  
  // Database configuration
  DATABASE_URL: z.string(),
  POSTGRES_USER: z.string().optional(),
  POSTGRES_PASSWORD: z.string().optional(),
  POSTGRES_DB: z.string().optional(),
  POSTGRES_HOST: z.string().optional(),
  POSTGRES_PORT: z.string().optional().transform(val => val ? Number(val) : undefined),
  
  // Redis configuration
  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.string().default('6379').transform(Number),
  REDIS_PASSWORD: z.string().optional(),
  
  // Authentication
  JWT_SECRET: z.string(),
  JWT_REFRESH_SECRET: z.string().optional(),
  JWT_EXPIRES_IN: z.string().default('1h'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  COOKIE_SECRET: z.string(),
  
  // DART API (optional when DISABLE_SYNC_WORKERS is true, as dartscrape handles sync)
  DART_API_KEY: z.string().optional().default(''),
  DART_API_BASE_URL: z.string().default('https://opendart.fss.or.kr/api'),
  DART_API_RATE_LIMIT: z.string().default('1000').transform(Number),

  // Document Extractor Service
  DOCUMENT_EXTRACTOR_API_URL: z.string().default('http://localhost:8000'),
  
  // AWS Configuration
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_REGION: z.string().default('ap-northeast-2'),
  // S3 region for PDF storage (consolidated bucket in Hong Kong)
  S3_REGION: z.string().default('ap-east-1'),
  S3_BUCKET_NAME: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  
  // Application URLs
  FRONTEND_URL: z.string().default('http://localhost:3000'),
  API_URL: z.string().optional(),

  // Monitoring and Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  SENTRY_DSN: z.string().optional(),
  
  // Queue Configuration
  BULL_DEFAULT_REMOVE_ON_COMPLETE: z.string().default('100').transform(Number),
  BULL_DEFAULT_REMOVE_ON_FAIL: z.string().default('50').transform(Number),
  FILING_SYNC_CONCURRENCY: z.string().default('2').transform(Number),
  DOCUMENT_PROCESSING_CONCURRENCY: z.string().default('5').transform(Number),
  PDF_PROCESSING_CONCURRENCY: z.string().default('3').transform(Number),
  TABLE_EXTRACTION_CONCURRENCY: z.string().default('3').transform(Number),
  
  // Development and Testing
  TEST_DATABASE_URL: z.string().optional(),
  DISABLE_AUTH_FOR_TESTS: z.string().default('false').transform(val => val === 'true'),

  // Worker Configuration
  // Set to true to disable sync workers (when dartscrape handles data sync)
  DISABLE_SYNC_WORKERS: z.string().default('false').transform(val => val === 'true'),
});

export type Environment = z.infer<typeof environmentSchema>;

class EnvironmentManager {
  private static instance: EnvironmentManager;
  private env: Environment;
  private isLoaded = false;

  private constructor() {
    this.env = {} as Environment;
  }

  public static getInstance(): EnvironmentManager {
    if (!EnvironmentManager.instance) {
      EnvironmentManager.instance = new EnvironmentManager();
    }
    return EnvironmentManager.instance;
  }

  public load(): Environment {
    if (this.isLoaded) {
      return this.env;
    }

    // Determine the root directory path
    const rootDir = path.join(__dirname, '..', '..', '..');
    
    // Load environment files in order of precedence
    const envFiles = [
      '.env.local',           // Local overrides (highest precedence)
      `.env.${process.env.NODE_ENV || 'development'}`, // Environment specific
      '.env',                 // Default environment file
    ];

    // Load each environment file (later files override earlier ones)
    envFiles.forEach(file => {
      const envPath = path.join(rootDir, file);
      try {
        dotenv.config({ path: envPath, override: false });
        console.log(`✅ Loaded environment from: ${file}`);
      } catch (error) {
        // Silently ignore missing files
        console.log(`⚠️  Environment file not found: ${file}`);
      }
    });

    // Validate and parse environment variables
    try {
      this.env = environmentSchema.parse(process.env);
      this.isLoaded = true;
      
      console.log(`🚀 Environment loaded successfully for: ${this.env.NODE_ENV}`);
      
      // Log important configuration (without secrets)
      console.log(`   Database: ${this.maskUrl(this.env.DATABASE_URL)}`);
      console.log(`   Redis: ${this.env.REDIS_URL}`);
      console.log(`   Server: ${this.env.HOST}:${this.env.PORT}`);
      console.log(`   Frontend: ${this.env.FRONTEND_URL}`);
      
      return this.env;
    } catch (error) {
      console.error('❌ Environment validation failed:');
      if (error instanceof z.ZodError) {
        error.errors.forEach(err => {
          console.error(`   ${err.path.join('.')}: ${err.message}`);
        });
      }
      
      // Provide helpful error messages for common issues
      this.provideHelpfulErrorMessages();
      
      throw new Error('Environment configuration is invalid. Please check your environment files.');
    }
  }

  public get(): Environment {
    if (!this.isLoaded) {
      return this.load();
    }
    return this.env;
  }

  public isDevelopment(): boolean {
    return this.get().NODE_ENV === 'development';
  }

  public isProduction(): boolean {
    return this.get().NODE_ENV === 'production';
  }

  public isTest(): boolean {
    return this.get().NODE_ENV === 'test';
  }

  private maskUrl(url: string): string {
    try {
      const parsed = new URL(url);
      if (parsed.password) {
        parsed.password = '***';
      }
      return parsed.toString();
    } catch {
      return url.replace(/:[^@]*@/, ':***@');
    }
  }

  private provideHelpfulErrorMessages(): void {
    console.error('\n🔧 Common solutions:');
    
    if (!process.env.DATABASE_URL) {
      console.error('   • DATABASE_URL is required. Check your .env.development file');
      console.error('   • Make sure Docker containers are running: docker-compose up -d');
    }
    
    if (!process.env.JWT_SECRET) {
      console.error('   • JWT_SECRET is required for authentication');
      console.error('   • Generate one with: openssl rand -base64 32');
    }
    
    if (!process.env.DART_API_KEY) {
      console.error('   • DART_API_KEY is required for Korean SEC data');
      console.error('   • Get one from: https://opendart.fss.or.kr');
    }
    
    console.error('\n📄 Environment file locations (in order of precedence):');
    console.error('   1. .env.local (local overrides)');
    console.error(`   2. .env.${process.env.NODE_ENV || 'development'} (environment specific)`);
    console.error('   3. .env (default)');
    console.error('\n');
  }
}

// Create singleton instance
const environmentManager = EnvironmentManager.getInstance();

// Load environment immediately
const env = environmentManager.load();

// Export the environment configuration
export { env };
export default environmentManager;

// Export commonly used environment checks
export const isDevelopment = () => environmentManager.isDevelopment();
export const isProduction = () => environmentManager.isProduction();
export const isTest = () => environmentManager.isTest();