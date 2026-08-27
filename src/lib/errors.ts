export class AppError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(message, 404);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(message, 403);
  }
}

// The request is well-formed, but the task isn't in a state that allows
// it (wrong lifecycle status, capacity full, open dependencies, ...).
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409);
  }
}

// A distinct status from ConflictError so the UI can tell "you need to
// go confirm this on the task page first" apart from an ordinary
// failure — see docs/spec.md's self-assign confirmation check
// (Coordination mechanics). 428 Precondition Required is the closest
// real HTTP status for "this would work, but you have to confirm
// first."
export class ConfirmationRequiredError extends AppError {
  constructor(message: string) {
    super(message, 428);
  }
}
