import { z } from 'zod';

export const envSchema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535),
    DB_URL: z.url({ protocol: /^postgres$/ }),
    DB_PASSWORD_FILE: z.string().trim().min(1).optional(),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  })
  .superRefine((env, context) => {
    const passwordInUrl = new URL(env.DB_URL).password;

    if (!passwordInUrl && !env.DB_PASSWORD_FILE) {
      context.addIssue({
        code: 'custom',
        path: ['DB_PASSWORD_FILE'],
        message: 'Required when DB_URL does not contain a password',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validate(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid config:\n${lines}`);
  }
  return parsed.data;
}
