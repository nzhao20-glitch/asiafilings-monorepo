import { z } from 'zod';

// Password validation: min 8 chars, must contain letters and numbers
const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[a-zA-Z]/, 'Password must contain at least one letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

// Zod schemas for validation
export const registerSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: passwordSchema,
  organization: z.string().min(2, 'Organization name is required'),
  fullName: z.string().min(2, 'Full name is required'),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

// JSON Schema equivalents for Fastify
export const registerJsonSchema = {
  type: 'object',
  required: ['email', 'password', 'organization', 'fullName'],
  properties: {
    email: { type: 'string', format: 'email' },
    password: { type: 'string', minLength: 8 },
    organization: { type: 'string', minLength: 2 },
    fullName: { type: 'string', minLength: 2 },
  },
};

export const loginJsonSchema = {
  type: 'object',
  required: ['email', 'password'],
  properties: {
    email: { type: 'string', format: 'email' },
    password: { type: 'string', minLength: 1 },
  },
};

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

// Password validation helper
export function validatePassword(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters');
  }
  if (!/[a-zA-Z]/.test(password)) {
    errors.push('Password must contain at least one letter');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  return { valid: errors.length === 0, errors };
}