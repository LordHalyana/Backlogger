export class HttpError extends Error {
  override readonly name = 'HttpError';
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export class ConflictError extends HttpError {
  constructor(code: string, message: string, details?: unknown) {
    super(409, code, message, details);
  }
}

export class NotFoundError extends HttpError {
  constructor(code: string, message: string) {
    super(404, code, message);
  }
}

export class BadRequestError extends HttpError {
  constructor(code: string, message: string, details?: unknown) {
    super(400, code, message, details);
  }
}

/** 428: a conditional write sent without its `If-Match`. */
export class PreconditionRequiredError extends HttpError {
  constructor(code: string, message: string) {
    super(428, code, message);
  }
}
