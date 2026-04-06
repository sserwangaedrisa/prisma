// routes/siteRoutes.ts
import { Router } from "express";
import verifyToken from "../middleware/auth.js";
import { authorize } from "../middleware/authorize";
import * as SiteController from "../controllers/sites";
import { upload } from "../middleware/multer";

const router = Router();

// All routes require authentication
router.use(verifyToken);

// Site CRUD operations
router.post("/sites", authorize(["OWNER", "ADMIN"]), SiteController.createSite);
router.get("/sites", authorize(["OWNER", "ADMIN"]), SiteController.getAllSites);
router.get(
  "/sites/:id",
  authorize(["OWNER", "ADMIN"]),
  SiteController.getSiteById,
);

// get site ids and names
router.get(
  "/allSitesIdsAndNames",
  authorize(["OWNER", "ADMIN"]),
  SiteController.getSiteIdsAndNames,
);

router.put(
  "/sites/:id",
  authorize(["OWNER", "ADMIN"]),
  SiteController.updateSite,
);
router.delete(
  "/sites/:id",
  authorize(["OWNER", "ADMIN"]),
  SiteController.deleteSite,
);

// Additional site operations
router.post(
  "/sites/:id/archive",
  authorize(["OWNER", "ADMIN"]),
  SiteController.archiveSite,
);
router.get(
  "/sites/:id/stats",
  authorize(["OWNER", "ADMIN"]),
  SiteController.getSiteStats,
);

export default router;
