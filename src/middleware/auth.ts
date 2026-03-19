import jwt from "jsonwebtoken";
import prisma from "../../prisma/config";
import { type Request, type Response, type NextFunction } from "express";

const verifyToken = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
      res.status(404).json({ message: "Invalid token" });
      return;
    }
    console.log("token: ", token);
    const decoded = jwt.verify(token, process.env.JWT_SECRET!);
    // const user = await prisma.user.findUnique({
    //   where: { id: decoded.id },
    //   select: {
    //     id: true,
    //     email: true,
    //     role: true,
    //     isActive: true,
    //   },
    // });

    // if (!user) {
    //   res.status(401).json({
    //     success: false,
    //     message: "User not found",
    //   });
    //   return;
    // }
    console.log("user: ", decoded);
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
