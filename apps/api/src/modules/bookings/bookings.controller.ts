import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../../lib/Apperror.js';
import { confirmBooking , createWalkInBooking, listBookings} from './bookings.service.js';
import {
  exchangeMagicLink,
  setBookingAccessCookie,
} from './magic-link.service.js';



export async function createBooking(
  req: Request,
  res: Response,
): Promise<void> {
  const {
    providerId,
    providerType,
    serviceId,
    datetime,
    customer,
  } = req.body;

  // authenticate middleware should have populated this.
  // Keep the check because Express does not know middleware ordering.
  if (!req.user) {
    throw new AppError(
      401,
      'UNAUTHENTICATED',
      'Authentication required.',
    );
  }

  // Booking holds are fenced to the authenticated server-side session.
  if (!req.sessionId) {
    throw new AppError(
      401,
      'UNAUTHENTICATED',
      'Authentication required.',
    );
  }

  if (
    typeof providerId !== 'string' ||
    typeof providerType !== 'string' ||
    typeof serviceId !== 'string' ||
    typeof datetime !== 'string'
  ) {
    throw new AppError(
      400,
      'INVALID_REQUEST',
      'Invalid booking request.',
    );
  }

  if (
    providerType !== 'staff' &&
    providerType !== 'resource'
  ) {
    throw new AppError(
      400,
      'INVALID_PROVIDER_TYPE',
      'Invalid provider type.',
    );
  }

  if (
    typeof customer !== 'object' ||
    customer === null ||
    typeof customer.name !== 'string' ||
    typeof customer.contactType !== 'string' ||
    typeof customer.contact !== 'string'
  ) {
    throw new AppError(
      400,
      'INVALID_CUSTOMER',
      'Invalid customer information.',
    );
  }

  if (
    customer.contactType !== 'email' &&
    customer.contactType !== 'phone'
  ) {
    throw new AppError(
      400,
      'INVALID_CONTACT_TYPE',
      'Contact type must be email or phone.',
    );
  }

  const result = await confirmBooking({
    businessId: req.user.businessId,
    providerId,
    providerType,
    serviceId,
    datetime,
    customer: {
      name: customer.name,
      contactType: customer.contactType,
      contact: customer.contact,
    },
    createdBy: null,
    sessionId: req.sessionId,
  });

  res.status(201).json({
    data: result,
  });
}

export function getBookingsStatus(
  _req: Request,
  res: Response,
): void {
  res.json({
    data: {
      module: 'bookings',
      status: 'skeleton',
    },
  });
}

export async function getBookings(
  req: Request,
  res: Response,
): Promise<void> {
  if (!req.user) {
    throw new AppError(
      401,
      'UNAUTHENTICATED',
      'Authentication required.',
    );
  }

  const bookings = await listBookings(req.user.businessId);

  res.json({
    data: bookings,
  });
}

export async function createWalkInBookingController(
  req: Request,
  res: Response,
): Promise<void> {
  if (!req.user) {
    throw new AppError(
      401,
      'UNAUTHENTICATED',
      'Authentication required.',
    );
  }

  const {
    providerId,
    providerType,
    serviceId,
    datetime,
    customer,
  } = req.body;

  if (
    typeof providerId !== 'string' ||
    typeof providerType !== 'string' ||
    typeof serviceId !== 'string' ||
    typeof datetime !== 'string'
  ) {
    throw new AppError(
      400,
      'INVALID_REQUEST',
      'Invalid booking request.',
    );
  }

  if (
    providerType !== 'staff' &&
    providerType !== 'resource'
  ) {
    throw new AppError(
      400,
      'INVALID_PROVIDER_TYPE',
      'Invalid provider type.',
    );
  }

  if (
    typeof customer !== 'object' ||
    customer === null ||
    typeof customer.name !== 'string' ||
    typeof customer.contactType !== 'string' ||
    typeof customer.contact !== 'string'
  ) {
    throw new AppError(
      400,
      'INVALID_CUSTOMER',
      'Invalid customer information.',
    );
  }

  if (
    customer.contactType !== 'email' &&
    customer.contactType !== 'phone'
  ) {
    throw new AppError(
      400,
      'INVALID_CONTACT_TYPE',
      'Contact type must be email or phone.',
    );
  }

  const result = await createWalkInBooking({
    businessId: req.user.businessId,
    providerId,
    providerType,
    serviceId,
    datetime,
    customer: {
      name: customer.name,
      contactType: customer.contactType,
      contact: customer.contact,
    },
    createdBy: req.user.userId,
  });

  res.status(201).json({
    data: result,
  });
}

export async function exchangeMagicLinkController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { bookingId, token } = req.body;

    if (
      typeof bookingId !== 'string' ||
      typeof token !== 'string' ||
      !bookingId ||
      !token
    ) {
      res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'bookingId and token are required.',
        },
      });
      return;
    }

    const booking = await exchangeMagicLink(bookingId, token);

    setBookingAccessCookie(
      res,
      bookingId,
      token,
    );

    res.json({
      data: {
        bookingId: String(booking._id),
      },
    });
  } catch (error) {
    next(error);
  }
}