import * as paymentController from "../controllers/payment";
import { Router } from "express";
import { authorize } from "../middleware/authorize";
import verifyToken from "../middleware/auth";

const router = Router();

// Single worker payment
router.post(
  "/workerPayment",
  verifyToken,
  authorize(["FOREMAN", "OWNER"]),
  paymentController.singleWorkerPayment,
);

// Single worker payment request route
router.post(
  "/worker",
  verifyToken,
  authorize(["FOREMAN", "OWNER"]),
  paymentController.singleWorkerPaymentRequest,
);

// Site payment summary
router.post(
  "/site",
  verifyToken,
  authorize(["FOREMAN", "OWNER"]),
  paymentController.sitePaymentSummary,
);

// Whole site payment request
router.post(
  "/sitePaymentRequest",
  verifyToken,
  authorize(["FOREMAN", "OWNER"]),
  paymentController.sitePaymentRequest,
);

// Get all payments with pagination, filtering, sorting
router.post(
  "/",
  verifyToken,
  authorize(["OWNER"]),
  paymentController.getPayments,
);

// Get all batches (with optional site filter)
router.post(
  "/batches",
  verifyToken,
  authorize(["FOREMAN", "OWNER"]),
  paymentController.getAllBatches,
);

// Get batch details by ID
router.get(
  "/batches/:batchId",
  verifyToken,
  authorize(["FOREMAN", "OWNER"]),
  paymentController.getBatchDetails,
);

// Get site batches (legacy - kept for backward compatibility)
router.get(
  "/batches/site/:siteId",
  verifyToken,
  authorize(["FOREMAN", "OWNER"]),
  paymentController.getSiteBatches,
);

// ==================== SINGLE PAYMENT ACTIONS ====================

// Approve a single payment
router.post(
  "/:paymentId/approve",
  verifyToken,
  authorize(["OWNER"]),
  paymentController.approveSinglePayment,
);

// Mark a single payment as paid
router.post(
  "/:paymentId/paid",
  verifyToken,
  authorize(["OWNER"]),
  paymentController.markSingleAsPaid,
);

// Send a single payment for review by the foreman to the owner
router.post(
  "/:paymentId/review",
  verifyToken,
  authorize(["FOREMAN"]),
  paymentController.reviewSinglePayment,
);

// Reject a single payment BY THE owner
router.post(
  "/:paymentId/reject",
  verifyToken,
  authorize(["OWNER"]),
  paymentController.rejectSinglePayment,
);

// Cancel a single payment (only if pending)
router.post(
  "/:paymentId/delete",
  verifyToken,
  authorize(["FOREMAN", "OWNER"]),
  paymentController.cancelSinglePayment,
);

// ==================== BATCH PAYMENT ACTIONS ====================

// Approve multiple payments at once
router.post(
  "/approve-batch",
  verifyToken,
  authorize(["OWNER"]),
  paymentController.approvePaymentsBatch,
);

// Mark multiple payments as paid
router.post(
  "/mark-paid-batch",
  verifyToken,
  authorize(["OWNER"]),
  paymentController.markMultipleAsPaid,
);

// Approve an entire batch of payments
router.post(
  "/batches/:batchId/approve",
  verifyToken,
  authorize(["OWNER"]),
  paymentController.approvePaymentBatch,
);

// Mark an entire batch as paid
router.post(
  "/batches/:batchId/paid",
  verifyToken,
  authorize(["OWNER"]),
  paymentController.markBatchAsPaid,
);

// Send an entire batch back for review by the forman to the owner
router.post(
  "/batches/:batchId/review",
  verifyToken,
  authorize(["FOREMAN"]),
  paymentController.reviewPaymentBatch,
);

// send multiple payments for review
router.post(
  "/batches/:multiple/review",
  verifyToken,
  authorize(["FOREMAN"]),
  paymentController.reviewMultiplePayments,
);

// Rejecting multiple payments i.e. sending the payments to the foreman for review
router.post(
  "/batches/:multiple/reject",
  verifyToken,
  authorize(["OWNER"]),
  paymentController.rejectingMultiplePayments,
);

// Cancel/delete an entire batch
router.delete(
  "/batches/:batchId",
  verifyToken,
  authorize(["FOREMAN", "OWNER"]),
  paymentController.cancelBatch,
);

// ==================== UTILITY ROUTES ====================

// Get all sites (for filtering)
router.get(
  "/sites/list",
  verifyToken,
  authorize(["FOREMAN", "OWNER"]),
  paymentController.getPaymentSites,
);

// Get payment statistics/dashboard data
router.get(
  "/statistics",
  verifyToken,
  authorize(["FOREMAN", "OWNER"]),
  paymentController.getPaymentStatistics,
);

// Export payments to CSV/Excel
router.get(
  "/export",
  verifyToken,
  authorize(["FOREMAN", "OWNER"]),
  paymentController.exportPayments,
);

// Get payment summary by date range
router.get(
  "/summary",
  verifyToken,
  authorize(["FOREMAN", "OWNER"]),
  paymentController.getPaymentSummary,
);

export default router;
