/**
 * Typed domain errors. Each carries a stable `code` and the HTTP status it maps to, so
 * the API layer can translate expected failure conditions into deterministic responses
 * instead of leaking 500s.
 */

export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Requested a family that does not exist. */
export class FamilyNotFoundError extends DomainError {
  constructor(id: string) {
    super(`Family '${id}' not found`, 'FAMILY_NOT_FOUND', 404);
  }
}

/** Input failed a business rule that Zod can't express (e.g. relationship index range). */
export class ValidationError extends DomainError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400);
  }
}

/** Requested a member that isn't part of the given family. */
export class MemberNotFoundError extends DomainError {
  constructor(memberId: string, familyId: string) {
    super(`Member '${memberId}' is not part of family '${familyId}'`, 'MEMBER_NOT_FOUND', 404);
  }
}

/** Member exists but hasn't drawn for the requested year. */
export class DrawNotFoundError extends DomainError {
  constructor(memberId: string, year: number) {
    super(`Member '${memberId}' has no draw for year ${year}`, 'DRAW_NOT_FOUND', 404);
  }
}

// Search is complete, so this means genuinely over-constrained — not that we gave up early.
export class NoValidAssignmentError extends DomainError {
  constructor(message = 'no assignment satisfies the constraints') {
    super(message, 'NO_VALID_ASSIGNMENT', 422);
  }
}

// Surfaced from the UNIQUE (exchange_id, giver_id) constraint — a race backstop; the service
// normally returns the existing draw idempotently before it gets here.
export class MemberAlreadyDrewError extends DomainError {
  constructor(memberId: string, year: number) {
    super(`Member '${memberId}' has already drawn for year ${year}`, 'MEMBER_ALREADY_DREW', 409);
  }
}
