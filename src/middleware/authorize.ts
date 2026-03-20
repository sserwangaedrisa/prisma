import { type Request, type Response, type NextFunction } from "express";

interface DecodedToken {
  id: string;
  role: string;
  iat: number;
  exp: number;
}

export const authorize = (allowedRoles: string | string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as DecodedToken;

      if (!user) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated",
        });
      }

      const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

      if (!roles.includes(user.role)) {
        return res.status(403).json({
          success: false,
          message: `Access denied. ${user.role} role is not authorized to access this resource`,
          allowedRoles: roles,
        });
      }
      next();
    } catch (error) {
      console.error("Authorization error:", error);
      return res.status(500).json({
        success: false,
        message: "Authorization failed",
      });
    }
  };
};
