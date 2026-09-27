/**
 * Bridges GramJS's interactive login callbacks (phone number, code, 2FA
 * password) to a stateless HTTP admin flow.
 *
 * client.start() expects async callbacks that resolve with each value as
 * it's needed. Here those callbacks return promises that stay pending until
 * the matching HTTP request arrives (POST .../login/code, .../login/password),
 * instead of reading from a terminal — there isn't one.
 */

export type LoginStatus =
  | "idle"
  | "connecting"
  | "awaiting_code"
  | "awaiting_password"
  | "logged_in"
  | "error";

interface PendingResolvers {
  code?: (value: string) => void;
  password?: (value: string) => void;
}

class LoginFlowState {
  status: LoginStatus = "idle";
  error: string | null = null;
  sessionString: string | null = null;
  private pending: PendingResolvers = {};

  reset(): void {
    this.status = "idle";
    this.error = null;
    this.sessionString = null;
    this.pending = {};
  }

  waitForCode(): Promise<string> {
    this.status = "awaiting_code";
    return new Promise((resolve) => {
      this.pending.code = resolve;
    });
  }

  waitForPassword(): Promise<string> {
    this.status = "awaiting_password";
    return new Promise((resolve) => {
      this.pending.password = resolve;
    });
  }

  submitCode(code: string): boolean {
    if (!this.pending.code) return false;
    const resolve = this.pending.code;
    this.pending.code = undefined;
    this.status = "connecting";
    resolve(code);
    return true;
  }

  submitPassword(password: string): boolean {
    if (!this.pending.password) return false;
    const resolve = this.pending.password;
    this.pending.password = undefined;
    this.status = "connecting";
    resolve(password);
    return true;
  }

  fail(message: string): void {
    this.status = "error";
    this.error = message;
  }

  succeed(sessionString: string): void {
    this.status = "logged_in";
    this.sessionString = sessionString;
  }
}

/** One login attempt at a time — a single-admin setup flow, not a multi-user one. */
export const loginFlow = new LoginFlowState();
