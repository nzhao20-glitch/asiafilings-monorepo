import { env, isProduction } from './environment';

export const authConfig = {
  jwt: {
    accessTokenSecret: env.JWT_SECRET,
    refreshTokenSecret: env.JWT_REFRESH_SECRET || env.JWT_SECRET,
    accessTokenExpiry: env.JWT_EXPIRES_IN,
    refreshTokenExpiry: env.JWT_REFRESH_EXPIRES_IN,
  },
  bcrypt: {
    saltRounds: 10,
  },
  cookie: {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
};