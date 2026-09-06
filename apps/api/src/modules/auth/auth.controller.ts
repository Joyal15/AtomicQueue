import type { RequestHandler } from 'express';
import { z } from 'zod';

import { asyncHandler } from '../../lib/asyncHandler.js';

import {
  acceptStaffInvitation,
  login ,
  logout,
  logoutEverywhere,
  signupOwner,
} from './auth.service.js';

const SESSION_COOKIE_NAME = 'session';

/** Body schema for POST /api/auth/signup, enforced by `validate()`. */
export const signupSchema = z.object({
  name: z.string().trim().min(1, 'Your name is required.'),
  email: z.string().trim().min(1, 'Email is required.').email('Enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
  businessName: z.string().trim().min(1, 'Business name is required.'),
});

/** Body schema for POST /api/auth/login. */
export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email is required.').email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
});

/** Body schema for POST /api/staff/invitations/:token/accept. */
export const acceptInvitationSchema = z.object({
  name: z.string().trim().min(1, 'Your name is required.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
});

const SESSION_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

export const getAuthStatus: RequestHandler = (_req, res) => {
  res.json({
    data: { module: 'auth', status: 'skeleton' },
  });
};

export const signupOwnerController = asyncHandler(async (req, res) => {
  const result = await signupOwner({
    name: req.body.name,
    email: req.body.email,
    password: req.body.password,
    businessName: req.body.businessName,
  });

  res.cookie(SESSION_COOKIE_NAME, result.sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: SESSION_COOKIE_MAX_AGE,
  });

  res.status(201).json({
    data: {
      user: result.user,
      business: result.business,
    },
  });
});

export const loginController = asyncHandler(async (req, res) => {
  const result = await login({
    email: req.body.email,
    password: req.body.password,
    ipAddress: req.ip ?? 'unknown',
  });

  res.cookie(SESSION_COOKIE_NAME, result.sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: SESSION_COOKIE_MAX_AGE,
  });

  res.status(200).json({
    data: {
      user: result.user,
    },
  });
});

export const logoutController = asyncHandler(async (req, res) => {
  const sessionId = req.cookies?.[SESSION_COOKIE_NAME];

  if (sessionId) {
    await logout(sessionId);
  }

  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
  });

  res.status(204).send();
});

export const logoutEverywhereController = asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required.',
      },
    });
    return;
  }

  await logoutEverywhere(req.user.userId);

  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
  });

  res.status(204).send();
});

export const acceptStaffInvitationController = asyncHandler(async (req, res) => {
  const result = await acceptStaffInvitation({
    token: req.params.token as string,
    name: req.body.name,
    password: req.body.password,
  });

  res.cookie(SESSION_COOKIE_NAME, result.sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    maxAge: SESSION_COOKIE_MAX_AGE,
  });

  res.status(200).json({
    data: {
      user: result.user,
    },
  });
});
