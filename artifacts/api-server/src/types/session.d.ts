import "express-session";

declare module "express-session" {
  interface SessionData {
    returnTo?: string;
    impersonatingEmployeeId?: string;
    realEmployeeId?: string;
  }
}
