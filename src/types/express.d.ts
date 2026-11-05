// Fields our middleware attaches to the Express request.
declare module "express-serve-static-core" {
  interface Request {
    id: string;
    // Set after a successful OAuth check: who the token was issued to and what it allows.
    auth?: { sub?: string; scopes: string[] };
  }
}

export {};
