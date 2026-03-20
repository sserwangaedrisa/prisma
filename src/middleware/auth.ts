import jwt from "jsonwebtoken";
import prisma from "../../prisma/config";
import { type Request, type Response, type NextFunction } from "express";

interface DecodedToken {
  id: string;
  role: string;
  iat: number;
  exp: number;
}

// declare global {
//   namespace Express {
//     interface Request {
//       user?: DecodedToken;
//     }
//   }
// }

const verifyToken = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    const cleanToken = token?.replace(/^["']|["']$/g, "").trim();

    if (!cleanToken) {
      res.status(404).json({ message: "Invalid token" });
      return;
    }

    const decoded = jwt.verify(
      cleanToken,
      process.env.JWT_SECRET!,
    ) as DecodedToken;

    req.user = decoded;
    next();
  } catch (err) {
    console.log(err);
    return res.status(401).json({
      message: "Authentication failed",
    });
  }
};

export default verifyToken;
