import { JwtPayload } from "jsonwebtoken";

interface User {
  id: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload | Partail<User> | null;
    }
  }
}
