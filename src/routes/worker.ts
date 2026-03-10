import * as workerControllers from "../controllers/worker";

import verifyToken from "../middleware/auth.js";
import { isAdmin } from "../middleware/role.js";
import { Router } from "express";
import { upload } from "../middleware/multer";
import { appendFile } from "fs";

const router = Router();

// Get requests

// Getting workers for a site/site details
router.post("/siteDetails", workerControllers.getSiteDetails);

export default router;
