import * as attendanceController from "../controllers/attendance";
import verifyToken from "../middleware/auth.js";
import { isAdmin } from "../middleware/role.js";
import { Router } from "express";

const router = Router();

router.post("/record", attendanceController.recordAttendance);
router.post("/todayAttendace", attendanceController.todayAttendace);

export default router;
