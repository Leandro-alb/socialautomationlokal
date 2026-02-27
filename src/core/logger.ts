import path from 'node:path';
import fs from 'node:fs';
import winston from 'winston';

const logDir = path.resolve(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, stack }) => {
      return stack
        ? `${timestamp} [${level}] ${message}\n${stack}`
        : `${timestamp} [${level}] ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: path.join(logDir, 'pipeline.log') })
  ]
});
