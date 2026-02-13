import { z } from 'zod';

// Auth schemas
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  organization: z.string().min(2),
  role: z.enum(['admin', 'user']).default('user')
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string()
});

// Filing schemas
export const filingSearchSchema = z.object({
  query: z.string().optional(),
  companyIds: z.array(z.string()).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  filingTypes: z.array(z.string()).optional(),
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(50)
});

export const dartSyncSchema = z.object({
  companyIds: z.array(z.string()).optional(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  filingTypes: z.array(z.string()).optional()
});

// Table export schemas
export const tableExportSchema = z.object({
  tableIds: z.array(z.string()),
  format: z.enum(['excel', 'csv', 'json'])
});

// Response schemas
export const apiResponseSchema = <T extends z.ZodType>(dataSchema: T) => z.object({
  success: z.boolean(),
  data: dataSchema.optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.any().optional()
  }).optional(),
  meta: z.object({
    page: z.number().optional(),
    total: z.number().optional(),
    timestamp: z.string().datetime()
  }).optional()
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type FilingSearchInput = z.infer<typeof filingSearchSchema>;
export type DartSyncInput = z.infer<typeof dartSyncSchema>;
export type TableExportInput = z.infer<typeof tableExportSchema>;