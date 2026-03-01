import multer from "multer";
import path from "path";
import fs from "fs";
import { type Request } from "express";

const uploadDir = path.join(
  __dirname,
  "..",
  "generated",
  "uploads",
  "blog"
);
console.log('Upload Directory:', uploadDir);
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/\s+/g, "_");
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const allowedTypes = ["image/jpeg", "image/png", "image/gif"];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Invalid file type"));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

export const deleteImage = async (filename: string): Promise<void> => {
  if (!filename) return;

  const filePath = path.join(uploadDir, filename);

  return new Promise((resolve, reject) => {
    fs.access(filePath, fs.constants.F_OK, (err) => {
      if (err) return resolve();

      fs.unlink(filePath, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
};

export default upload;
