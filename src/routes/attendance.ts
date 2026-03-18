import * as attendanceController from "../controllers/attendance";
import verifyToken from "../middleware/auth.js";
import { isAdmin } from "../middleware/role.js";
import { Router } from "express";

const router = Router();
// Record attendace
router.post("/record", attendanceController.recordAttendance);
router.post("/todayAttendace", attendanceController.todayAttendace);

router.post("/bulk", attendanceController.bulkCreateWorkEntries);

// CRUD operations
router.put("/:id", attendanceController.updateWorkEntry);
router.delete("/:id", attendanceController.deleteWorkEntry);

// Get entries
router.get("/worker/:workerId", attendanceController.getWorkerWorkEntries);
router.get("/site/:siteId", attendanceController.getSiteWorkEntries);

export default router;
