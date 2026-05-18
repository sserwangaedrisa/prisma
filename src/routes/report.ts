import express from "express";
import {
  getSiteSummaries,
  getMonthlyComparison,
  getPaymentStatusReport,
  getWorkEntryStatusReport,
  getCompanyReport,
  getSiteReport,
  getWorkersSummary,
} from "../controllers/report";
import { validateUser } from "../middleware/validation";

const router = express.Router();

router.use(validateUser);

// Site summaries (overview)
router.get("/summaries", getSiteSummaries);

// Monthly comparison stats (last N months)
router.get("/monthly-comparison", getMonthlyComparison);

// Detailed payment status report
router.get("/payments", getPaymentStatusReport);

// Detailed work entry status report
router.get("/work-entries", getWorkEntryStatusReport);

// Company-wide report (date range within a single month)
router.get("/company", getCompanyReport);

// Site-specific report (date range within a single month)
router.get("/site/:siteId", getSiteReport);

// Worker performance summary (date range within a single month)
router.get("/workers-summary", getWorkersSummary);

export default router;
