import * as attendanceController from "../controllers/attendance";
import verifyToken from "../middleware/auth.js";
import { authorize } from "../middleware/authorize";
import { isAdmin } from "../middleware/role.js";
import { Router } from "express";

const router = Router();
// Record attendace
router.post("/record", attendanceController.recordAttendance);
router.post("/todayAttendace", attendanceController.todayAttendace);

router.post("/bulk", attendanceController.bulkCreateWorkEntries);

// CRUD operations
router.put("/:id", attendanceController.updateWorkEntry);
router.post(
  "/delete",
  verifyToken,
  authorize(["FOREMAN", "OWNER"]),
  attendanceController.deleteWorkEntry,
);
// router.put("/bulk", attendanceController.updateBulk)

// Get entries
router.get("/worker/:workerId", attendanceController.getWorkerWorkEntries);
router.get("/site/:siteId", attendanceController.getSiteWorkEntries);

export default router;
