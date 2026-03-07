import multer from "multer";

// Store file in memory
export const upload = multer({ storage: multer.memoryStorage() });
