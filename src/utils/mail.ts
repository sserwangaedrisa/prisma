import nodemailer from "nodemailer";

console.log(process.env.SENDER_EMAIL, process.env.SENDER_EMAIL_PASSWORD);

const transporter = nodemailer.createTransport({
  //host: 'mail.spacemail.com',
  service: "gmail",
  //port: 465, // Changed from 993 to 465 for SMTP over SSL
  //secure: true, // true for port 465, false for port 587
  auth: {
    user: process.env.SENDER_EMAIL || "donations@gataama.com",
    pass: process.env.SENDER_EMAIL_PASSWORD || "ABCabc123*#",
  },
});

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
    await transporter.sendMail({
      from: `Gataama <${process.env.SENDER_EMAIL}>`,
      sender: process.env.SENDER_EMAIL,
      subject: subject,
      to: recipient,
      html: message,
    });
  } catch (error) {
    throw new Error("Error sending mail");
  }
}
