import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  //host: 'mail.spacemail.com',
  service: "gmail",
  auth: {
    user: process.env.SENDER_EMAIL,
    pass: process.env.SENDER_EMAIL_PASSWORD,
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
