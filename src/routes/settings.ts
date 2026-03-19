import express from "express";
import verifyToken from "../middleware/auth";
import {
  getLatestSettings,
  getSettingsByDate,
  createSettings,
  updateSettings,
  getSettingsHistory,
} from "../controllers/settings.js";
import { Router } from "express";

const router = Router();

// Get routes (accessible by all authenticated users)
router.post("/latest", getLatestSettings);
router.post("/history", getSettingsHistory);
router.post("/byDate", getSettingsByDate);

// Create/Update routes (restricted to owners and foremen)
router.post("/create", verifyToken, createSettings);
router.post("/update", verifyToken, updateSettings);

export default router;
