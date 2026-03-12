import { google } from "googleapis";
import { Readable } from "stream";
import "dotenv/config";

interface UploadResult {
  status: string;
  id: string;
  link: string;
  message?: string;
}

const SHARED_DRIVE_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || "";

export async function uploadToDrive(
  file: Express.Multer.File,
): Promise<UploadResult> {
  try {
    if (!file || !file.buffer) {
      return {
        status: "error",
        id: "",
        link: "",
        message: "Invalid file",
      };
    }

    const auth = new google.auth.GoogleAuth({
      keyFile: "service-account.json",
      scopes: ["https://www.googleapis.com/auth/drive"],
    });

    const drive = google.drive({ version: "v3", auth });

    const bufferStream = new Readable();
    bufferStream.push(file.buffer);
    bufferStream.push(null);

    // IMPORTANT: Upload to Shared Drive
    const response = await drive.files.create({
      requestBody: {
        name: file.originalname,
        mimeType: file.mimetype,
        parents: [SHARED_DRIVE_ID], // Shared Drive ID
      },
      media: {
        mimeType: file.mimetype,
        body: bufferStream,
      },
      fields: "id, webViewLink",
      supportsAllDrives: true, // Required for Shared Drives
    });

    const fileId = response.data.id;

    if (!fileId) {
      return {
        status: "error",
        id: "",
        link: "",
        message: "Upload failed, no file ID returned",
      };
    }

    // Make file publicly accessible (optional)
    await drive.permissions.create({
      fileId,
      requestBody: {
        role: "reader",
        type: "anyone",
      },
      supportsAllDrives: true, // Required for Shared Drives
    });

    return {
      status: "success",
      id: fileId,
      link:
        response.data.webViewLink || `https://drive.google.com/uc?id=${fileId}`,
    };
  } catch (error: any) {
    console.error("Upload failed:", error);
    return {
      status: "error",
      id: "",
      link: "",
      message: error.message || "Upload failed",
    };
  }
}
