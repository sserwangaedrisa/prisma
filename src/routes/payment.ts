import * as paymentController from "../controllers/payment";
import { Router } from "express";
import { authorize } from "../middleware/authorize";
import verifyToken from "../middleware/auth";

const rounter = Router();

rounter.post(
  "/workerPayment",
  verifyToken,
  authorize(["FOREMAN", "OWNER"]),
  paymentController.singleWorkerPayment,
);

export default rounter;
