import express from "express";
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
router.post("/create", createSettings);
router.put("/:id", updateSettings);

export default router;
