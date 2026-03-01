import { type Request, type Response } from "express";
import asyncHandler from "express-async-handler";
import bcrypt from "bcryptjs";
import uploadToDrive from "../utils/googleDrive.js";
import { google } from "googleapis";
import sendEmail from "../utils/mail.js";
import prisma from "../../prisma/config.js";
import handleError from "../utils/errorHandler.js";
import { validateEmail } from "../utils/emailVerification.js";
import {
  generateAccessToken,
  generateRefreshToken,
  generateOTP,
} from "../utils/generate.js";

const auth = new google.auth.GoogleAuth({
  keyFile: "utils/credentials.json",
  scopes: ["https://www.googleapis.com/auth/drive.readonly"],
});

export const getImage = async (req: Request, res: Response) => {
  const fileId = Array.isArray(req.params?.id)
    ? req.params.id[0]
    : req.params?.id;

  if (!fileId) {
    return res.status(400).send("File ID is required");
  }

  try {
    const authClient: any = await auth.getClient();
    const drive = google.drive({ version: "v3", auth: authClient });

    const fileResponse = await drive.files.get(
      { fileId: fileId, alt: "media" },
      { responseType: "stream" },
    );

    res.setHeader("Content-Type", "image/jpeg");

    fileResponse.data
      .on("error", (err) => {
        console.error("Stream Error:", err.message);
        res.sendStatus(500);
      })
      .pipe(res);
  } catch (err: any) {
    console.error("Google Drive fetch error:", err.message);
    res.status(404).send("Image not found or access denied");
  }
};

export const users = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    try {
      const users = await prisma.user.findMany();

      res.status(200).json({ data: users });
    } catch (error) {
      handleError(error, res);
    }
  },
);

export const registerUser = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { name, email, password, phone, isActive, createdAt, role } =
      req.body;

    if (
      !name ||
      !email ||
      !phone ||
      !password ||
      !isActive ||
      !createdAt ||
      !role
    ) {
      res.status(400).json({ message: "All fields are required" });
      return;
    }
    if (email) {
      if (!validateEmail(email)) {
        res.status(400).json({ message: "Invalid email address" });
        return;
      }
    }

    try {
      const existingUser = await prisma.user.findUnique({
        where: { email: email.toLowerCase().trim() },
      });

      if (existingUser) {
        res.status(403).json({ message: "Email taken, use a different one" });
        return;
      }
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      const verificationCode = generateOTP();
      const verificationExpiry = new Date(Date.now() + 15 * 60 * 1000);

      const user = await prisma.user.create({
        data: {
          name: name.trim(),
          email: email.toLowerCase().trim(),
          password: hashedPassword,
          role: role,
          isActive,
          createdAt,
          verificationCode,
          verificationExpiry,
        },
        select: { id: true, name: true, email: true },
      });

      //sending verification email logic will be added here later
      const html = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Email verification</title>
                <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/bootstrap/5.2.2/css/bootstrap.min.css"
                integrity="sha512-CpIKUSyh9QX2+zSdfGP+eWLx23C8Dj9/XmHjZY2uDtfkdLGo0uY12jgcnkX9vXOgYajEKb/jiw67EYm+kBf+6g=="
                crossorigin="anonymous" referrerpolicy="no-referrer" />
            </head>
            <body>
                <div class="container">
                <div class="row">
                    <div class="col">
                    <p>Dear ${user.name}, Your new account was created successfully</p>
                    <p>Use the OTP ${verificationCode} to verify your account</p>
                    
                    <p>Best,</p>
                    <p>The Gataama Team.</p>
                    </div>
                </div>
                </div>
                <script src="https://cdnjs.cloudflare.com/ajax/libs/bootstrap/5.2.2/js/bootstrap.min.js"
                integrity="sha512-5BqtYqlWfJemW5+v+TZUs22uigI8tXeVah5S/1Z6qBLVO7gakAOtkOzUtgq6dsIo5c0NJdmGPs0H9I+2OHUHVQ=="
                crossorigin="anonymous" referrerpolicy="no-referrer"></script>
            </body>
            </html>`;
      await sendEmail({
        recipient: user.email,
        subject: "Company - Email Verification",
        message: html,
      });

      res.status(201).json({
        message: `Verification code sent to your email. Check your inbox to finish the registration`,
        userId: user.id,
        pagestate: "emailVerification",
      });
    } catch (error) {
      handleError(error, res);
    }
  },
);

export const loginUser = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ message: "Email and password are required" });
      return;
    }

    if (!validateEmail(email)) {
      res.status(400).json({ message: "Invalid email address" });
      return;
    }

    try {
      const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase().trim() },
        select: {
          id: true,
          fullName: true,
          email: true,
          password: true,
          status: true,
          role: {
            select: {
              id: true,
              name: true,
              description: true,
            },
          },
          country: {
            select: {
              id: true,
              name: true,
              flagUrl: true,
            },
          },
        },
      });

      if (!user) {
        res.status(401).json({
          message: "Invalid user credentials",
        });
        return;
      }

      const isPasswordValid = await bcrypt.compare(
        password.toString(),
        user.password as string,
      );

      if (!isPasswordValid) {
        res.status(401).json({
          message: "Invalid user credentials",
        });
      }

      if (user.status === "banned") {
        res.status(403).json({
          message:
            "Your account has been permanently suspended. Contact support for more information.",
        });
        return;
      }
      if (user.status === "suspended") {
        res.status(403).json({
          message:
            "Your account is temporarily suspended. Please try again later or contact support.",
        });
        return;
      }
      if (user.status === "in_active") {
        await prisma.user.update({
          where: { id: user.id },
          data: { status: "active" },
        });
      }

      res.status(200).json({
        message: "Login successful",
        user: user,
        tokens: {
          accessToken: generateAccessToken(user.id),
          refreshToken: generateRefreshToken(user.id),
        },
      });
    } catch (error) {
      handleError(error, res);
    }
  },
);

export const resendOTP = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { userId } = req.body;
      if (!userId) {
        res
          .status(400)
          .json({ message: "The userId missing, Please signup again." });
        return;
      }

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        res.status(404).json({ message: "User not found" });
        return;
      }

      const otp = generateOTP();
      await prisma.user.update({
        where: { id: userId },
        data: {
          verificationCode: otp,
          verificationExpiry: new Date(Date.now() + 10 * 60 * 1000),
        },
      });

      const emailHtml = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Gataama - OTP Verification</title>
                <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/bootstrap/5.2.2/css/bootstrap.min.css"
                integrity="sha512-CpIKUSyh9QX2+zSdfGP+eWLx23C8Dj9/XmHjZY2uDtfkdLGo0uY12jgcnkX9vXOgYajEKb/jiw67EYm+kBf+6g=="
                crossorigin="anonymous" referrerpolicy="no-referrer" />
            </head>
            <body>
                <div class="container">
                <div class="row">
                    <div class="col">
                    <p>Dear ${user.name},</p>
                    <p>Your new OTP code is <strong>${otp}</strong>. Please use this code to verify your account.</p>
                    <p>This OTP is valid for 10 minutes.</p>
                    <p>Best regards,</p>
                    <p>The Gataama Team.</p>
                    </div>
                </div>
                </div>
                <script src="https://cdnjs.cloudflare.com/ajax/libs/bootstrap/5.2.2/js/bootstrap.min.js"
                integrity="sha512-5BqtYqlWfJemW5+v+TZUs22uigI8tXeVah5S/1Z6qBLVO7gakAOtkOzUtgq6dsIo5c0NJdmGPs0H9I+2OHUHVQ=="
                crossorigin="anonymous" referrerpolicy="no-referrer"></script>
            </body>
            </html>`;
      await sendEmail({
        recipient: user.email,
        subject: "Company - OTP Verification",
        message: emailHtml,
      });

      res.status(200).json({
        message: "OTP resent successfully. Please check your email.",
      });
    } catch (error) {
      handleError(error, res);
    }
  },
);

export const verifyAccount = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { otp, userId } = req.body;

      if (!otp || otp.length !== 6) {
        res.status(400).json({ message: "Provide a valid OTP" });
        return;
      }

      if (!userId) {
        res.status(400).json({ message: "user id missing" });
        return;
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, verificationCode: true, verificationExpiry: true },
      });
      if (!user) {
        res.status(400).json({ message: "user not found" });
        return;
      }

      if (!user.verificationCode || !user.verificationExpiry) {
        res
          .status(400)
          .json({ message: "No OTP found, please request a new one" });
        return;
      }

      if (user.verificationExpiry! < new Date()) {
        await prisma.user.update({
          where: { id: userId },
          data: {
            verificationCode: null,
            verificationExpiry: null,
          },
        });

        res.status(400).json({
          message:
            "OTP expired, signup again to get the new verification code!",
        });
        return;
      }

      if (user.verificationCode !== otp.trim()) {
        res.status(400).json({ message: "incorrect OTP" });
        return;
      }

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
          status: true,
          verificationCode: null,
          verificationExpiry: null,
        },
        select: { id: true },
      });

      res.status(200).json({
        pageState: "login",
        message: "Account verified successfully. Proceed to login",
        data: updatedUser,
      });
    } catch (error) {
      handleError(error, res);
    }
  },
);

export const getAdmin = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    try {
      const admins = await prisma.user.findMany({
        where: {
          role: {
            is: {
              name: {
                in: ["admin", "countryAdmin"],
              },
            },
          },
        },
        select: {
          id: true,
          fullName: true,
          email: true,
          createdAt: true,
          role: {
            select: {
              id: true,
              name: true,
            },
          },
          country: {
            select: {
              id: true,
              name: true,
              iso2: true,
            },
          },
        },
      });

      res.status(200).json({ admins: admins });
    } catch (error) {
      console.log(error);
      handleError(error, res);
    }
  },
);

export const forgotPassword = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { email } = req.body;

      if (!email.trim()) {
        res.status(400).json({ message: "Email is required." });
        return;
      }
      if (!validateEmail(email)) {
        res.status(400).json({ message: "Invalid email address." });
        return;
      }

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        res.status(404).json({ message: "User not found." });
        return;
      }

      const tempPasswordNumber = Math.floor(1000 + Math.random() * 9000);
      const tempPassword = `${tempPasswordNumber}rfh`;

      const hashedPassword = await bcrypt.hash(tempPassword, 10);

      await prisma.user.update({
        where: { id: user.id },
        data: { password: hashedPassword },
      });

      const emailHtml = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Gataama - Password Reset</title>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/bootstrap/5.2.2/css/bootstrap.min.css"
                integrity="sha512-CpIKUSyh9QX2+zSdfGP+eWLx23C8Dj9/XmHjZY2uDtfkdLGo0uY12jgcnkX9vXOgYajEKb/jiw67EYm+kBf+6g=="
                crossorigin="anonymous" referrerpolicy="no-referrer" />
            </head>
            <body>
                <div class="container">
                    <div class="row">
                        <div class="col">
                            <p>Your new account password is <strong>${tempPassword}</strong>.</p>
                            <p>Best regards,</p>
                            <p>The Company.</p>
                        </div>
                    </div>
                </div>
                <script src="https://cdnjs.cloudflare.com/ajax/libs/bootstrap/5.2.2/js/bootstrap.min.js"
                integrity="sha512-5BqtYqlWfJemW5+v+TZUs22uigI8tXeVah5S/1Z6qBLVO7gakAOtkOzUtgq6dsIo5c0NJdmGPs0H9I+2OHUHVQ=="
                crossorigin="anonymous" referrerpolicy="no-referrer">
                </script>
            </body>
            </html>
        `;

      await sendEmail({
        recipient: user.email,
        subject: "Gataama - Password Reset",
        message: emailHtml,
      });

      res.status(200).json({
        message: "A temporary password has been sent to your email address.",
      });
    } catch (error) {
      handleError(error, res);
    }
  },
);

export const updateUser = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    try {
      // const userId = req.params.id;
      const userId = Array.isArray(req.params?.id)
        ? req.params.id[0]
        : req.params?.id;

      const existingUser = await prisma.user.findUnique({
        where: { id: userId! },
      });

      if (!existingUser) {
        res.status(404).json({ message: "User not found" });
        return;
      }

      const updatedData = {
        fullName: req.body.fullName || existingUser.name,
        email: req.body.email || existingUser.email,
        role: req.body.roleId || existingUser.role,
      };

      const updatedUser = await prisma.user.update({
        where: { id: userId! },
        data: updatedData,
      });

      res.status(200).json({
        message: `Profile updated successfully`,
        data: updatedUser,
      });
    } catch (error) {
      handleError(error, res);
    }
  },
);

export const deleteUser = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = Array.isArray(req.params?.id)
        ? req.params.id[0]
        : req.params?.id;

      const deletedUser = await prisma.user.delete({
        where: { id: userId! },
      });

      if (!deletedUser) {
        res.status(404).json({ message: "User not found" });
        return;
      }

      res.status(200).json({
        message: `Deleted user ${deletedUser.name} successfully`,
      });
    } catch (error) {
      handleError(error, res);
    }
  },
);
