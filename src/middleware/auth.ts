import jwt from "jsonwebtoken";
import { type Request, type Response, type NextFunction } from "express";

const verifyToken = async (req:Request, res:Response, next:NextFunction) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if(!token){
      res.status(404).json({ message: "Invalid token" });
      return;
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET!);
   req.user = decoded;
   console.log('req.user', req.user)
    next();
  } catch (err) {
    return res.status(401).json({
      message: 'Authentication failed',
    });
  }
};

export default verifyToken;
