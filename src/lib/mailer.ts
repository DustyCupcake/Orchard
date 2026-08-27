import nodemailer from "nodemailer";

let transporter: nodemailer.Transporter | null = null;

// Falls back to logging the email to the console when SMTP isn't
// configured — lets `npm run dev` and local testing work without real
// SMTP credentials. In production, .env's SMTP_* (Brevo by default, per
// docs/architecture.md) makes this send for real.
function getTransporter(): nodemailer.Transporter | null {
  if (!process.env.SMTP_HOST) {
    return null;
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined,
    });
  }
  return transporter;
}

export async function sendMagicLinkEmail(email: string, url: string) {
  const from = process.env.SMTP_FROM || "Orchard <no-reply@example.com>";
  const subject = "Your Orchard login link";
  const text = `Click to log in to Orchard:\n\n${url}\n\nThis link expires in 15 minutes and works once.`;

  const client = getTransporter();
  if (!client) {
    console.log(`[mailer] SMTP not configured — magic link for ${email}:\n${url}`);
    return;
  }

  await client.sendMail({ from, to: email, subject, text });
}
