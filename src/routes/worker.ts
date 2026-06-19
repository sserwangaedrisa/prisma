import * as workerControllers from "../controllers/worker.js";
import verifyToken from "../middleware/auth.js";
import { Router } from "express";
import { upload } from "../middleware/multer.js";
import { appendFile } from "fs";

const router = Router();

// Get requests

// Getting workers for a site/site details
router.post("/siteDetails", workerControllers.getSiteDetails);

//gettin paginated workers
router.post("/search", workerControllers.getPaginatedSiteWorkers);

//getting workers present today
router.post("/search/today", workerControllers.getPaginatedSiteWorkers);

export default router;
