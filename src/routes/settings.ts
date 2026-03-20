import express from "express";
import verifyToken from "../middleware/auth";
import { authorize } from "../middleware/authorize";
import {
  getLatestSettings,
  getSettingsByDate,
  createSettings,
  updateSettings,
  getSettingsHistory,
  deleteSettings,
} from "../controllers/settings.js";
import { Router } from "express";

const router = Router();

// Get routes (accessible by all authenticated users)
router.post(
  "/latest",
  verifyToken,
  authorize(["FOREMAN", "OWNER"]),
  getLatestSettings,
);
router.post(
  "/history",
  verifyToken,
  authorize(["FOREMAN", "OWNER"]),
  getSettingsHistory,
);
router.post(
  "/byDate",
  verifyToken,
  authorize(["FOREMAN", "OWNER"]),
  getSettingsByDate,
);

// Create/Update routes (restricted to owners and foremen)
router.post(
  "/create",
  verifyToken,
  authorize(["FOREMAN", "OWNER"]),
  createSettings,
);
router.post(
  "/update",
  verifyToken,
  authorize(["FOREMAN", "OWNER"]),
  updateSettings,
);

router.post(
  "/delete",
  verifyToken,
  authorize(["FOREMAN", "OWNER"]),
  deleteSettings,
);

export default router;
