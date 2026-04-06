import e, { type Request, type Response } from "express";
import asyncHandler from "express-async-handler";
import bcrypt from "bcryptjs";
import uploadToD from "../utils/googleDrive.js";
import { google } from "googleapis";
import sendEmail from "../utils/mail.js";
import prisma from "../../prisma/config.js";
import handleError from "../utils/errorHandler.js";
import { validateEmail } from "../utils/emailVerification.js";
import { uploadToDrive } from "../middleware/image-upload.js";
import { uploadToSupabase } from "../utils/uploadToSupabase.js";
import { validateUser, validateMonthNotLocked } from "../middleware/validation";
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

export const getForemen = async (req: Request, res: Response) => {
  try {
    const foremen = await prisma.user.findMany({
      where: {
        role: "FOREMAN",
        isActive: true,
        status: "ACTIVE",
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (foremen.length === 0) {
      res.status(200).json({ message: "No foremen found", data: [] });
      return;
    }

    return res.status(200).json({ data: foremen });
  } catch (error) {
    handleError(error, res);
  }
};

// getting all users
export const getAllUsers = async (req: Request, res: Response) => {
  try {
    // Pagination parameters
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit as string) || 10),
    ); // Max 100 items per request
    const skip = (page - 1) * limit;

    // Sorting parameters
    const sortBy = (req.query.sortBy as string) || "name";
    const sortOrder =
      (req.query.sortOrder as string) === "desc" ? "desc" : "asc";

    // Filter parameters
    const search = req.query.search as string;
    const role = req.query.role as string;
    const status = req.query.status as string;
    const isActive =
      req.query.isActive === "true"
        ? true
        : req.query.isActive === "false"
          ? false
          : undefined;

    // Build where clause
    let whereClause: any = {};

    if (search) {
      whereClause.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
      ];
    }

    if (role) {
      if (
        ["LABORER", "FOREMAN", "OWNER", "ADMIN"].includes(role.toUpperCase())
      ) {
        whereClause.role = role;
      }
      if (
        [
          "USER",
          "HELPER",
          "MASON",
          "STEEL_FIXER",
          "FOREMAN",
          "SITE_ADMIN",
          "PAINTER",
          "ELECTRICIAN",
          "ADMIN",
        ].includes(role.toUpperCase())
      ) {
        whereClause.job = role;
      }
    }

    if (status) {
      whereClause.status = status;
    }

    if (isActive !== undefined) {
      whereClause.isActive = isActive;
    }

    // Execute parallel queries for better performance
    const [totalUsers, users] = await Promise.all([
      prisma.user.count({ where: whereClause }),
      prisma.user.findMany({
        where: whereClause,
        select: {
          id: true,
          email: true,
          name: true,
          phone: true,
          role: true,
          job: true,
          wageRating: true,
          imageUrl: true,
          status: true,
          isActive: true,
          createdAt: true,
        },
        orderBy: {
          [sortBy]: sortOrder,
        },
        skip: skip,
        take: limit,
      }),
    ]);

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalUsers / limit);

    res.status(200).json({
      message: "Users retrieved successfully",
      success: true,
      data: users,
      pagination: {
        currentPage: page,
        totalItems: totalUsers,
        totalPages: totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
        startIndex: skip + 1,
        endIndex: Math.min(skip + limit, totalUsers),
      },
      count: users.length,
    });
    return;
  } catch (error) {
    console.error("Error while getting users:", error);
    res.status(500).json({
      message: "Error while getting users",
      success: false,
    });
  }
};

// getting active site workers
export const getActiveSiteWorkers = asyncHandler(
  async (req: Request, res: Response) => {
    const { siteId } = req.body;

    if (!siteId) {
      res.status(400).json({
        message: "Site ID is required",
        success: false,
      });
      return;
    }

    try {
      const activeWorkersForSite = await prisma.siteWorker.findMany({
        where: {
          siteId: siteId,
          worker: {
            isActive: true,
          },
        },
        select: {
          worker: {
            select: {
              id: true,
              email: true,
              name: true,
              phone: true,
              role: true,
              job: true,
              wageRating: true,
              imageUrl: true,
              status: true,
            },
          },
          assignedAt: true,
        },
        orderBy: {
          worker: {
            name: "asc",
          },
        },
      });

      // ✅ Arrays are never null, check length instead
      if (activeWorkersForSite.length === 0) {
        res.status(200).json({
          message: "No active workers found for this site",
          success: true,
          data: [],
        });
        return;
      }

      res.status(200).json({
        message: "Workers retrieved successfully",
        success: true,
        data: activeWorkersForSite,
        count: activeWorkersForSite.length,
      });
      return;
    } catch (error) {
      console.error("Error while getting site workers:", error);
      res.status(500).json({
        message: "Error while getting site workers",
        success: false,
      });
      return;
    }
  },
);

//
export const getAllSiteWorkers = asyncHandler(
  async (req: Request, res: Response) => {
    const { siteId } = req.body;

    if (!siteId) {
      res.status(400).json({
        message: "Site ID is required",
        success: false,
      });
      return;
    }

    try {
      const activeWorkersForSite = await prisma.siteWorker.findMany({
        where: {
          siteId: siteId,
        },
        select: {
          worker: {
            select: {
              id: true,
              email: true,
              name: true,
              phone: true,
              role: true,
              job: true,
              wageRating: true,
              imageUrl: true,
              status: true,
              isActive: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          assignedAt: true,
        },
        orderBy: {
          worker: {
            isActive: "desc",
          },
        },
      });

      if (activeWorkersForSite.length === 0) {
        res.status(200).json({
          message: "No  workers found for this site",
          success: true,
          data: [],
        });
        return;
      }

      res.status(200).json({
        message: "Workers retrieved successfully",
        success: true,
        data: activeWorkersForSite,
        count: activeWorkersForSite.length,
      });
      return;
    } catch (error) {
      console.error("Error while getting site workers:", error);
      res.status(500).json({
        message: "Error while getting site workers",
        success: false,
      });
      return;
    }
  },
);

export const registerUser = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { name, email, password, phone, role, sites, job, wageRating } =
      req.body;
    const userId = req.user.id;

    if (
      !name ||
      !email ||
      !phone ||
      !password ||
      !role ||
      !job ||
      !wageRating
    ) {
      res
        .status(200)
        .json({ status: "missing-fields", message: "All fields are required" });
      return;
    }

    if (!validateEmail(email)) {
      res.status(200).json({ message: "Invalid email address" });
      return;
    }

    let siteId: string | string[] = "";

    if (sites) {
      siteId = sites as string[]; // Assuming sites is an array of site IDs
    }

    if (!sites) {
      const site = await prisma.site.findFirst({
        where: { foremanId: userId },
        select: {
          id: true,
        },
      });

      if (!site) {
        res.status(200).json({
          status: "failed",
          message: "site not found login again to continue",
        });
        return;
      }
      siteId = site.id;
    }

    try {
      const existingUser = await prisma.user.findUnique({
        where: { email: email.toLowerCase().trim() },
      });

      if (existingUser) {
        res.status(200).json({
          status: "email-taken",
          message: "Email taken, use a different one",
        });
        return;
      }

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      const verificationCode = generateOTP();
      const verificationExpiry = new Date(Date.now() + 1 * 60 * 1000);

      const Email = email.toLowerCase().trim();

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
                    <p>Dear ${name}, Your new account was created successfully</p>
                    <p>Use the OTP <em style="color: blue;">${verificationCode}</em> to verify your account</p>
                    <p>Best,</p>
                    <p>Labor company</p>
                    </div>
                </div>
                </div>
                <script src="https://cdnjs.cloudflare.com/ajax/libs/bootstrap/5.2.2/js/bootstrap.min.js"
                integrity="sha512-5BqtYqlWfJemW5+v+TZUs22uigI8tXeVah5S/1Z6qBLVO7gakAOtkOzUtgq6dsIo5c0NJdmGPs0H9I+2OHUHVQ=="
                crossorigin="anonymous" referrerpolicy="no-referrer"></script>
            </body>
            </html>`;

      await sendEmail({
        recipient: Email,
        subject: "Company - Email Verification",
        message: html,
      });

      /* ---------------- IMAGE UPLOAD ---------------- */

      let imageUrl: string | undefined;

      if (req.file) {
        const superbaseImageLink = await uploadToSupabase(req.file);

        if (superbaseImageLink !== "Failed to apload") {
          imageUrl = superbaseImageLink;
        }
      }

      /* ---------------- CREATE USER ---------------- */

      const user = await prisma.user.create({
        data: {
          name: name.trim(),
          email: email.toLowerCase().trim(),
          password: hashedPassword,
          role,
          wageRating: parseFloat(wageRating),
          job,
          isActive: false,
          verificationCode,
          verificationExpiry,
          imageUrl,
        },
        select: { id: true, name: true, email: true },
      });

      let siteAttachment;

      console.log("siteId: ", siteId);
      console.log("typeof siteId: ", typeof siteId);
      console.log("user.id: ", user.id);

      if (siteId) {
        if (typeof siteId === "string") {
          siteAttachment = await prisma.siteWorker.create({
            data: {
              workerId: user.id,
              siteId: siteId,
            },
          });
        } else if (Array.isArray(siteId)) {
          const assignments = siteId.map((siteId) => ({
            workerId: user.id,
            siteId: siteId,
          }));

          siteAttachment = await prisma.siteWorker.createMany({
            data: assignments,
          });
        }
      }

      // const siteAttachment = await prisma.siteWorker.create({
      //   data: {
      //     siteId: siteId,
      //     workerId: user.id,
      //   },
      // });

      if (!siteAttachment) {
        res.status(200).json({
          message: "Failed to attach a to site",
          success: false,
          status: "site attachment failed",
        });
      }

      await prisma.activityLog.create({
        data: {
          userId,
          action: "Created user",
          entity: "user",
          entityId: user.id,
        },
      });

      res.status(200).json({
        status: "success",
        message:
          "Verification code sent to your email. Check your inbox to finish the registration",
        userId: user.id,
        pagestate: "emailVerification",
      });
    } catch (error) {
      console.log(error);
      handleError(error, res);
    }
  },
);

// login user
export const loginUser = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(200).json({ message: "Email and password are required" });
      return;
    }

    if (!validateEmail(email)) {
      res.status(200).json({ message: "Invalid email address" });
      return;
    }

    try {
      const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase().trim() },
        select: {
          id: true,
          name: true,
          email: true,
          password: true,
          isActive: true,
          status: true,
          role: true,
          foremanSites: {
            select: { id: true },
          },
        },
      });

      if (!user) {
        res.status(200).json({
          message: "Invalid user credentials",
        });
        return;
      }

      const isPasswordValid = await bcrypt.compare(
        password.toString(),
        user.password as string,
      );

      if (!isPasswordValid) {
        res.status(200).json({
          message: "Invalid user credentials",
        });
      }

      if (user.status === "BLOCKED") {
        res.status(200).json({
          message:
            "Your account has been permanently BLOCKED. Contact support for more information.",
        });
        return;
      }
      if (user.status === "SUSPENDED") {
        res.status(200).json({
          message:
            "Your account is temporarily suspended. Please try again later or contact support.",
        });
        return;
      }
      if (!user.isActive) {
        res.status(200).json({
          message:
            "Your account is not activated. Please try again later or contact support.",
        });
        return;
      }

      res.status(200).json({
        message: "Login successful",
        user: user,
        tokens: {
          accessToken: generateAccessToken(user.id, user.role),
          refreshToken: generateRefreshToken(user.id, user.role),
        },
      });
    } catch (error) {
      console.log("error: ", error);
      handleError(error, res);
    }
  },
);

export const resendOTP = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { userId } = req.body;
      if (!userId) {
        res.status(200).json({
          status: "user_id_missing",
          message: "The userId missing, Please signup again.",
        });
        return;
      }

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        res.status(200).json({
          status: "user_not_found",
          message: "User not found",
        });
        return;
      }

      const otp = generateOTP();

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
                    <p>Your new OTP code is <strong style="color: blue">${otp}</strong>. Please use this code to verify your account.</p>
                    <p>This OTP is valid for 10 minutes.</p>
                    <p>Best regards,</p>
                    <p>Labor compony.</p>
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

      await prisma.user.update({
        where: { id: userId },
        data: {
          verificationCode: otp,
          verificationExpiry: new Date(Date.now() + 10 * 60 * 1000),
        },
      });

      res.status(200).json({
        status: "success",
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
        res.status(200).json({
          status: "invalid_otp",
          message: "Provide a valid OTP",
        });
        return;
      }

      if (!userId) {
        res.status(200).json({
          status: "user_id_missing",
          message: "user id missing, please signup to create an account",
        });
        return;
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, verificationCode: true, verificationExpiry: true },
      });
      if (!user) {
        res.status(200).json({
          status: "user_not_found",
          message: "user not found , please signup to create an account",
        });
        return;
      }

      if (!user.verificationCode || !user.verificationExpiry) {
        res.status(200).json({
          status: "no_otp",
          message: "No OTP found, please send a new one",
        });
        return;
      }

      if (user.verificationExpiry! < new Date()) {
        res.status(200).json({
          status: "expired",
          message: "Otp provided is expired, please ask fo the new otp!",
        });
        return;
      }

      if (user.verificationCode !== otp.trim()) {
        res.status(200).json({
          status: "incorrect_otp",
          message: "incorrect OTP",
        });
        return;
      }

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
          status: "ACTIVE",
          isActive: true,
          verificationCode: null,
          verificationExpiry: null,
        },
        select: { id: true, email: true },
      });

      res.status(200).json({
        user: updatedUser,
        status: "success",
        message: `Account verified successfully. Proceed to login with your ${updatedUser.email} and your password to access your dashboard.`,
      });
    } catch (error) {
      handleError(error, res);
    }
  },
);

export const verifyEmail = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { email } = req.body;
      if (!email) {
        res.status(200).json({
          status: "Email_missing",
          message: "The email missing, Please fill in the email and try again.",
        });
        return;
      }

      const user = await prisma.user.findUnique({ where: { email: email } });
      if (!user) {
        res.status(200).json({
          status: "user_not_found",
          message: "User not found",
        });
        return;
      }

      const otp = generateOTP();

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
                    <p>Your OTP code is <strong style="color: blue">${otp}</strong>. Please use this code to verify your account.</p>
                    <p>This OTP is valid for 10 minutes.</p>
                    <p>Best regards,</p>
                    <p>Labor compony.</p>
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

      const newUser = await prisma.user.update({
        where: { email: email },
        data: {
          verificationCode: otp,
          verificationExpiry: new Date(Date.now() + 10 * 60 * 1000),
        },
        select: {
          id: true,
          email: true,
        },
      });

      res.status(200).json({
        user: newUser,
        status: "success",
        message: "OTP resent successfully. Please check your email.",
      });
    } catch (error) {
      handleError(error, res);
    }
  },
);

export const resetPassword = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { email, newPassword } = req.body;

      if (!email.trim()) {
        res.status(200).json({ message: "Email is required." });
        return;
      }
      if (!validateEmail(email)) {
        res.status(200).json({ message: "Invalid email address." });
        return;
      }

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        res
          .status(200)
          .json({ message: "User not found. SignUp again to continue" });
        return;
      }

      // const tempPasswordNumber = Math.floor(1000 + Math.random() * 9000);
      // const tempPassword = `${tempPasswordNumber}rfh`;

      const hashedPassword = await bcrypt.hash(newPassword, 10);

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
                            <p>Your new account password has been set successfully, please login using your newly set password.</p>
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
        subject: "Company port- Password Reset",
        message: emailHtml,
      });
      await prisma.user.update({
        where: { id: user.id },
        data: { password: hashedPassword },
      });

      res.status(200).json({
        status: "success",
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

/**
 * Block a user
 * Sets isActive to false and status to BLOCKED
 * Also records deactivation reason and timestamp
 */
export const blockUser = async (req: Request, res: Response) => {
  const { userId, deactivationReason } = req.body;
  try {
    // Check if user exists

    const userInfo = await validateUser(userId);
    if (!userInfo || !userInfo.success) {
      res.status(200).json({
        message: "Target account is already non ACTIVE",
        success: false,
      });
      return;
    }

    const pendingPayments = await prisma.payment.count({
      where: {
        workerId: userId,
        status: "PENDING",
      },
    });

    const pendingWorkEntries = await prisma.workEntry.count({
      where: {
        workerId: userId,
        status: "NOT_PAID",
      },
    });

    if (pendingPayments > 0 || pendingWorkEntries > 0) {
      res.status(200).json({
        message: "worker has pending payments",
        success: false,
      });
      return;
    }

    // Update user to blocked status
    const blockedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        isActive: false,
        status: "BLOCKED",
        deactivationReason: deactivationReason ? deactivationReason : "",
        deactivatedAt: new Date(),
      },
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true,
        status: true,
        role: true,
      },
    });

    //  Creating activity log for the block action
    await prisma.activityLog.create({
      data: {
        userId: req.user.id,
        action: "USER_BLOCKED",
        entity: "User",
        entityId: userId,
      },
    });

    return res.status(200).json({
      success: true,
      message: "User blocked successfully",
    });
  } catch (error) {
    console.error("Error blocking user:", error);
    res.status(200).json({
      message: "error while blocking the user",
      success: false,
    });
    throw error;
    return;
  }
};

/**
 * Unblock a user
 * Sets isActive to true and status to ACTIVE
 * Records reactivation timestamp
 */
export const unblockUser = async (req: Request, res: Response) => {
  const { userId, reactivationReason } = req.body;
  try {
    if (!userId) {
      res.status(200).json({
        message: "userId missing, try again",
        success: false,
      });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true, isActive: true },
    });

    if (!user) {
      res.status(200).json({
        message: "user not found",
        success: false,
      });
      return;
    }

    if (user?.status === "DELETED") {
      res.status(200).json({
        message: "account permanetly blocked",
        success: false,
      });
      return;
    }

    // Check if user exists

    const unblockedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        isActive: true,
        status: "ACTIVE",
        reactivatedAt: new Date(),
        deactivatedAt: null,
      },
    });

    //  activity log for the unblock action
    await prisma.activityLog.create({
      data: {
        userId: req.user.id,
        action: "USER_UNBLOCKED",
        entity: "User",
        entityId: userId,
      },
    });

    return res.status(200).json({
      success: true,
      message: "User unblocked successfully",
    });
  } catch (error) {
    console.error("Error unblocking user:", error);

    throw error;
    res.status(500).json({
      message: "error while unblocking the user",
      success: false,
    });
    return;
  }
};

/**
 * Get blocked users with optional filters
 */
export const getBlockedUsers = async (filters?: {
  role?: string;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  limit?: number;
}) => {
  try {
    const { role, startDate, endDate, page = 1, limit = 10 } = filters || {};
    const skip = (page - 1) * limit;

    const whereClause: any = {
      status: "BLOCKED",
    };

    if (role) {
      whereClause.role = role;
    }

    if (startDate || endDate) {
      whereClause.deactivatedAt = {};
      if (startDate) whereClause.deactivatedAt.gte = startDate;
      if (endDate) whereClause.deactivatedAt.lte = endDate;
    }

    const [blockedUsers, totalCount] = await Promise.all([
      prisma.user.findMany({
        where: whereClause,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          status: true,
          phone: true,
          createdAt: true,
          _count: {
            select: {
              workerRecords: {
                where: {
                  status: "NOT_PAID",
                },
              },
              payments: {
                where: {
                  status: "PENDING",
                },
              },
            },
          },
        },
        skip,
        take: limit,
        orderBy: {},
      }),
      prisma.user.count({
        where: whereClause,
      }),
    ]);

    return {
      success: true,
      data: blockedUsers,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    };
  } catch (error) {
    console.error("Error fetching blocked users:", error);
    throw error;
  }
};

/**
 * Temporarily suspend a user (alternative to full block)
 * Sets status to SUSPENDED but maintains isActive state
 */
export const suspendUser = async (
  userId: string,
  reason?: string,
  duration?: number,
) => {
  try {
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existingUser) {
      throw new Error("User not found");
    }

    if (existingUser.status === "SUSPENDED") {
      throw new Error("User is already suspended");
    }

    const suspendedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        status: "SUSPENDED",
      },
    });

    await prisma.activityLog.create({
      data: {
        userId: userId,
        action: "USER_SUSPENDED",
        entity: "User",
        entityId: userId,
      },
    });

    return {
      success: true,
      message: "User suspended successfully",
      data: suspendedUser,
    };
  } catch (error) {
    console.error("Error suspending user:", error);
    throw error;
  }
};
