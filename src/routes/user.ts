import {
  registerUser,
  verifyAccount,
  resendOTP,
  deleteUser,
  loginUser,
  resetPassword,
  verifyEmail,
  //uploadImage,
  getImage,
  updateUser,
  getAdmin,
  users,
} from "../controllers/user.js";

import {
  loginUserPolicy,
  forgotPasswordPolicy,
} from "../middleware/validation.js";

import verifyToken from "../middleware/auth.js";
import { isAdmin } from "../middleware/role.js";
import { Router } from "express";
import { upload } from "../middleware/multer";
const router = Router();

router.get("/", users);
router.post("/register", upload.single("image"), registerUser);
router.post("/verify-account", verifyAccount);
router.post("/resend-otp", resendOTP);
router.post("/verifyEmail", verifyEmail);
router.post("/login", loginUserPolicy, loginUser);
router.patch("/resetPassword", resetPassword);

//router.post("/upload", upload.single("image"), uploadImage);
router.get("/images/:id", getImage);
router.patch("/profile/:id", verifyToken, isAdmin, updateUser);

router.get("/admins", getAdmin);

router.delete("/:id", verifyToken, isAdmin, deleteUser);

export default router;
