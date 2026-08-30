import nodemailer from "nodemailer";

let transporter: nodemailer.Transporter | null = null;

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
      // nodemailer's own defaults are 2 minutes each — a relay that's
      // unreachable (DNS/network issue, not a fast SMTP-level rejection)
      // would otherwise hang the login request for that long with nothing
      // surfaced to the caller.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }
  return transporter;
}

// "Name <email>" -> {name, email}, since Brevo's API wants them split
// rather than one RFC5322 address string like nodemailer takes.
function parseFrom(from: string): { name?: string; email: string } {
  const match = from.match(/^\s*(.*?)\s*<(.+)>\s*$/);
  return match ? { name: match[1] || undefined, email: match[2] } : { email: from };
}

// BREVO_API_KEY takes priority over SMTP_HOST when both are set: it's a
// plain HTTPS call, so it works from an IPv6-only box where none of the
// SMTP relays we tried (Brevo's own relay included) are reachable — their
// submission servers are IPv4-only even though the API itself sits behind
// normal dual-stack web infrastructure.
async function sendViaBrevoApi(from: string, to: string, subject: string, text: string) {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": process.env.BREVO_API_KEY!,
    },
    body: JSON.stringify({
      sender: parseFrom(from),
      to: [{ email: to }],
      subject,
      textContent: text,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Brevo API send failed (${res.status}): ${body}`);
  }
}

export async function sendMagicLinkEmail(email: string, url: string) {
  const from = process.env.SMTP_FROM || "Orchard <no-reply@example.com>";
  const subject = "Your Orchard login link";
  const text = `Click to log in to Orchard:\n\n${url}\n\nThis link expires in 15 minutes and works once.`;

  if (process.env.BREVO_API_KEY) {
    await sendViaBrevoApi(from, email, subject, text);
    return;
  }

  const client = getTransporter();
  if (!client) {
    // Lets `npm run dev` and local testing work without real credentials.
    console.log(`[mailer] no BREVO_API_KEY or SMTP_HOST configured — magic link for ${email}:\n${url}`);
    return;
  }

  await client.sendMail({ from, to: email, subject, text });
}
