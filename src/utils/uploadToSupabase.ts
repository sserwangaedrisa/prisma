import { supabase } from "../config/supabase";

export const uploadToSupabase = async (file: Express.Multer.File) => {
  if (!file || !file.buffer) throw new Error("No file provided");

  // Create a unique file name
  const fileName = `${Date.now()}-${file.originalname}`;

  // Upload buffer directly
  const { error } = await supabase.storage
    .from(process.env.SUPABASE_BUCKET!)
    .upload(fileName, file.buffer, {
      contentType: file.mimetype,
    });

  if (error) throw error;

  // Get public URL
  const { data } = supabase.storage
    .from(process.env.SUPABASE_BUCKET!)
    .getPublicUrl(fileName);

  return data.publicUrl;
};
