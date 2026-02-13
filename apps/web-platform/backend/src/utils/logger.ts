import pino from 'pino';
import { env, isProduction } from '../config/environment';

// Create logger instance
export const logger = pino({
  level: env.LOG_LEVEL,
  transport: !isProduction() 
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'yyyy-mm-dd HH:MM:ss',
          ignore: 'pid,hostname'
        }
      }
    : undefined,
  formatters: {
    level: (label) => {
      return { level: label };
    }
  }
});

export default logger;