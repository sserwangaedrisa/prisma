import { google } from "googleapis";
import { Readable } from "stream";

export default async function uploadToD(file: any) {
  try {
    if (!file || !file.buffer || !file.mimetype || !file.originalname) {
      console.error("Invalid or missing file object");
      throw new Error("Invalid or missing file object");
    }

    let auth;
    try {
      console.log("🔐 Setting up Google Auth...");
      auth = new google.auth.GoogleAuth({
        keyFile: "../../service-account.json",
        scopes: ["https://www.googleapis.com/auth/drive"],
      });
    } catch (authError: any) {
      console.error("Failed to set up Google Auth:", authError);
      throw new Error("Failed to set up Google Auth: " + authError.message);
    }

    let drive;
    try {
      drive = google.drive({ version: "v3", auth });
    } catch (driveError: any) {
      throw new Error(
        "Failed to initialize Google Drive API: " + driveError.message,
      );
    }

    let bufferStream;
    try {
      bufferStream = new Readable();
      bufferStream.push(file.buffer);
      bufferStream.push(null);
      console.log("✅ Buffer stream created");
    } catch (streamError: any) {
      console.error(" Failed to create buffer stream:", streamError);
      throw new Error("Failed to create buffer stream: " + streamError.message);
    }

    let res;
    try {
      res = await drive.files.create({
        requestBody: {
          name: file.originalname,
          mimeType: file.mimetype,
        },
        media: {
          mimeType: file.mimetype,
          body: bufferStream,
        },
        supportsAllDrives: true,
        fields: "id, webViewLink, webContentLink",
      });
    } catch (uploadError: any) {
      console.error(" Upload failed:", uploadError);
      throw new Error(
        "Failed to upload file to Google Drive: " + uploadError.message,
      );
    }

    try {
      await drive.permissions.create({
        fileId: res.data.id!,
        requestBody: {
          role: "reader",
          type: "anyone",
        },
      });
    } catch (permError: any) {
      console.error("Failed to set permissions:", permError);
      throw new Error("Failed to set file permissions: " + permError.message);
    }

    const result = {
      status: "success",
      id: res.data.id,
      link: res.data.webViewLink,
    };

    return result;
  } catch (err) {
    console.error("uploadToDrive failed:", err);
    throw err;
  }
}
