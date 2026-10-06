import type { NextFunction, Request, Response } from 'express';

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = 'error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function httpError(status: number, message: string, code?: string): HttpError {
  return new HttpError(status, message, code);
}

type Handler = (req: Request, res: Response, next: NextFunction) => unknown | Promise<unknown>;

/** Wrap async route handlers so rejections reach the error middleware. */
export function ah(handler: Handler): RequestHandlerLike {
  return (req, res, next) => {
    try {
      const out = handler(req, res, next);
      if (out && typeof (out as Promise<unknown>).catch === 'function') {
        (out as Promise<unknown>).catch(next);
      }
    } catch (err) {
      next(err);
    }
  };
}

export type RequestHandlerLike = (req: Request, res: Response, next: NextFunction) => void;
