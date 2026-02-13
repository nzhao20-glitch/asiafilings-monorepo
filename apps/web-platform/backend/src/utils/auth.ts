import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { authConfig } from '../config/auth';

export interface JWTPayload {
  userId: string;
  email: string;
  role: string;
}

export interface RefreshTokenPayload {
  userId: string;
  sessionId: string;
}

export const hashPassword = async (password: string): Promise<string> => {
  return bcrypt.hash(password, authConfig.bcrypt.saltRounds);
};

export const verifyPassword = async (password: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};

export const generateAccessToken = (payload: JWTPayload): string => {
  return jwt.sign(payload, authConfig.jwt.accessTokenSecret, {
    expiresIn: authConfig.jwt.accessTokenExpiry,
  } as jwt.SignOptions);
};

export const generateRefreshToken = (payload: RefreshTokenPayload): string => {
  return jwt.sign(payload, authConfig.jwt.refreshTokenSecret, {
    expiresIn: authConfig.jwt.refreshTokenExpiry,
  } as jwt.SignOptions);
};

export const verifyAccessToken = (token: string): JWTPayload => {
  return jwt.verify(token, authConfig.jwt.accessTokenSecret) as JWTPayload;
};

export const verifyRefreshToken = (token: string): RefreshTokenPayload => {
  return jwt.verify(token, authConfig.jwt.refreshTokenSecret) as RefreshTokenPayload;
};

export const extractTokenFromHeader = (authHeader?: string): string | null => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
};