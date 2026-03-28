import * as paymentController from "../controllers/payment";
import { Router } from "express";
import { authorize } from "../middleware/authorize";
import verifyToken from "../middleware/auth";

const router = Router();

router.post(
  "/workerPayment",
  verifyToken,
  authorize(["FOREMAN", "OWNER"]),
  paymentController.singleWorkerPayment,
);

// single worker payment request route
router.post(
  "/worker",
  verifyToken,
  authorize(["FOREMAN", "OWNER"]),
  paymentController.singleWorkerPaymentRequest,
);

// site payment summary
router.post(
  "/site",
  verifyToken,
  authorize(["FOREMAN", "OWNER"]),
  paymentController.sitePaymentSummary,
);

export default router;
