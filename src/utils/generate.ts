import crypto from "crypto";
import jwt from 'jsonwebtoken';
import 'dotenv/config';


export const generateOTP = ()=> {
    const otp = crypto.randomInt(100000, 999999).toString();
    return otp;
}

export const generateAccessToken = (id:string): string => {
    const secretKey = process.env.JWT_SECRET!
    const expiresIn = '15m';

    return jwt.sign({ id }, secretKey, { expiresIn });
};

export const generateRefreshToken = (id:string): string => {
    const secretKey = process.env.JWT_SECRET!
    const expiresIn = '30d';

    return jwt.sign({ id }, secretKey, { expiresIn });
};
