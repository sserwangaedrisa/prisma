import nodemailer from "nodemailer";

console.log(process.env.SENDER_EMAIL, process.env.SENDER_EMAIL_PASSWORD);

const transporter = nodemailer.createTransport({
  //host: 'mail.spacemail.com',
  service: "gmail",
  //port: 465, // Changed from 993 to 465 for SMTP over SSL
  //secure: true, // true for port 465, false for port 587
  auth: {
    user: process.env.SENDER_EMAIL,
    pass: process.env.SENDER_EMAIL_PASSWORD,
  },
});

// Create a transporter using Ethereal test credentials.
// For production, replace with your actual SMTP server details.
// const transporter = nodemailer.createTransport({
//   host: "smtp.ethereal.email",
//   port: 587,
//   secure: false, // Use true for port 465, false for port 587
//   auth: {
//     user: process.env.SENDER_EMAIL,
//     pass: process.env.SENDER_EMAIL_PASSWORD,
//   },
// });

type sendMailProps = {
  recipient: string;
  subject: string;
  message: string;
};

export default async function sendEmail({
  recipient,
  subject,
  message,
}: sendMailProps) {
  try {
    console.log("sender", process.env.SENDER_EMAIL);
    console.log("password", process.env.SENDER_EMAIL_PASSWORD);
    await transporter.sendMail({
      from: `Labor company <${process.env.SENDER_EMAIL}>`,
      sender: process.env.SENDER_EMAIL,
      subject: subject,
      to: recipient,
      html: message,
    });
  } catch (error) {
    console.log("erro", error);
    throw new Error("Error sending mail");
  }
}
