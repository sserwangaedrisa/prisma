import express from "express";
import { authorize } from "../middleware/authorize.js";
import verifyToken from "../middleware/auth.js";

import {
  getSiteSummaries,
  getMonthlyComparison,
  getPaymentStatusReport,
  getWorkEntryStatusReport,
  getCompanyReport,
  getSiteReport,
  getWorkersSummary,
} from "../controllers/report.js";

const router = express.Router();

router.use(verifyToken);

// Site summaries (overview)
router.post("/summaries", getSiteSummaries);

// Monthly comparison stats (last N months)
router.post("/monthly-comparison", getMonthlyComparison);

// Detailed payment status report
router.post("/payments", getPaymentStatusReport);

// Detailed work entry status report
router.post("/work-entries", getWorkEntryStatusReport);

// Company-wide report (date range within a single month)
router.post("/company", getCompanyReport);

// Site-specific report (date range within a single month)
router.post("/site/:siteId", getSiteReport);

// Worker performance summary (date range within a single month)
router.post("/workers-summary", getWorkersSummary);

export default router;
