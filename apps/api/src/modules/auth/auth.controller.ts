import type { RequestHandler } from 'express';

import { signupOwner } from './auth.service.js';

const SESSION_COOKIE_NAME = 'session';

const SESSION_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

export const getAuthStatus: RequestHandler = (_req, res) => {
  res.json({
    data: { module: 'auth', status: 'skeleton' },
  });
};

export const signupOwnerController: RequestHandler = async (req, res, next) => {
  try {
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
  } catch (error) {
    next(error);
  }
};