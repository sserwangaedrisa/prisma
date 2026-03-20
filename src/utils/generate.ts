import crypto from "crypto";
import jwt from "jsonwebtoken";
import "dotenv/config";

export const generateOTP = () => {
  const otp = crypto.randomInt(100000, 999999).toString();
  return otp;
};

export const generateAccessToken = (id: string, role: string): string => {
  const secretKey = process.env.JWT_SECRET!;
  const expiresIn = "60m";

  return jwt.sign({ id, role }, secretKey, { expiresIn });
};

export const generateRefreshToken = (id: string, role: string): string => {
  const secretKey = process.env.JWT_SECRET!;
  const expiresIn = "30d";

  return jwt.sign({ id, role }, secretKey, { expiresIn });
};
