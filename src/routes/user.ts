import {
  registerUser,
  verifyAccount,
  resendOTP,
  deleteUser,
  loginUser,
  resetPassword,
  verifyEmail,
  //uploadImage,
  getActiveSiteWorkers,
  getImage,
  getForemen,
  updateUser,
  getAllUsers,
  blockUser,
  unblockUser,
  getAllSiteWorkers,
} from "../controllers/user.js";

import {
  loginUserPolicy,
  forgotPasswordPolicy,
} from "../middleware/validation.js";
import verifyToken from "../middleware/auth.js";
import { authorize } from "../middleware/authorize.js";

import { Router } from "express";
import { upload } from "../middleware/multer";
import { ActivityLogScalarFieldEnum } from "../../prisma/generated/internal/prismaNamespace.js";
const router = Router();

// Register users
router.post(
  "/register",
  verifyToken,
  authorize(["FOREMAN", "OWNER"]),
  upload.single("image"),
  registerUser,
);
// verify account
router.post(
  "/verify-account",
  verifyToken,
  authorize(["FOREMAN", "OWNER"]),
  verifyAccount,
);
// get active workers
router.post(
  "/activeSiteWorkers",
  verifyToken,
  authorize(["FOREMAN", "OWNER"]),
  getActiveSiteWorkers,
);

// get all users
router.get(
  "/allUsers",
  verifyToken,
  authorize(["OWNER", "ADMIN"]),
  getAllUsers,
);

// get all site workers
router.post(
  "/allSiteWorkers",
  verifyToken,
  authorize(["FOREMAN", "OWNER"]),
  getAllSiteWorkers,
);

router.post(
  "/blockUser",
  verifyToken,
  authorize(["FOREMAN", "OWNER"]),
  blockUser,
);
router.post(
  "/unblockUser",
  verifyToken,
  authorize(["FOREMAN", "OWNER"]),
  unblockUser,
);

router.post("/resend-otp", resendOTP);
router.post("/verifyEmail", verifyEmail);
router.post("/login", loginUserPolicy, loginUser);
router.patch("/resetPassword", resetPassword);

// get foremen
router.get("/foremen", verifyToken, authorize(["OWNER"]), getForemen);

//router.post("/upload", upload.single("image"), uploadImage);
router.get("/images/:id", getImage);

export default router;
