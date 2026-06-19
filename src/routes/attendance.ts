import * as attendanceController from "../controllers/attendance.js";
import verifyToken from "../middleware/auth.js";
import { authorize } from "../middleware/authorize.js";
import { Router } from "express";

const router = Router();
// Record attendace
router.post(
  "/record",
  verifyToken,
  authorize(["FOREMAN", "OWNER"]),
  attendanceController.recordAttendance,
);
router.post("/todayAttendace", attendanceController.todayAttendace);
// Bulk create work entries for a site on a specific date
router.post(
  "/bulk",
  verifyToken,
  authorize(["FOREMAN", "OWNER"]),
  attendanceController.bulkCreateWorkEntries,
);

// Delete a work entry (or multiple entries for a worker on a specific date)
router.post(
  "/deleteBulk",
  verifyToken,
  authorize(["FOREMAN", "OWNER"]),
  attendanceController.bulkDeleteWorkEntries,
);

// CRUD operations
router.post(
  "/delete",
  verifyToken,
  authorize(["FOREMAN", "OWNER"]),
  attendanceController.deleteWorkEntry,
);

// Get entries
router.get("/worker/:workerId", attendanceController.getWorkerWorkEntries);
router.get("/site/:siteId", attendanceController.getSiteWorkEntries);

export default router;
