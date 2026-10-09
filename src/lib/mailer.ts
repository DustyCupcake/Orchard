import nodemailer from "nodemailer";

// nodemailer 10 ships its own types (the separate @types package described
// 8.x and has been removed), and no longer exposes a `Transporter` namespace
// member; the type of what createTransport returns is the honest spelling.
type Transporter = ReturnType<typeof nodemailer.createTransport>;

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
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

// The shared low-level send path both sendMagicLinkEmail and Phase 51's
// own sendTaskNominationEmail now go through — same
// Brevo-API-first-then-SMTP-then-console-log fallback either way, kept
// in one place rather than duplicated per email kind.
async function sendPlainTextEmail(to: string, subject: string, text: string, logFallback: string) {
  const from = process.env.SMTP_FROM || "Orchard <no-reply@example.com>";

  if (process.env.BREVO_API_KEY) {
    await sendViaBrevoApi(from, to, subject, text);
    return;
  }

  const client = getTransporter();
  if (!client) {
    // Lets `npm run dev` and local testing work without real credentials.
    console.log(`[mailer] no BREVO_API_KEY or SMTP_HOST configured — ${logFallback}`);
    return;
  }

  await client.sendMail({ from, to, subject, text });
}

export async function sendMagicLinkEmail(email: string, url: string) {
  const subject = "Your Orchard login link";
  const text = `Click to log in to Orchard:\n\n${url}\n\nThis link expires in 15 minutes and works once.`;
  await sendPlainTextEmail(email, subject, text, `magic link for ${email}:\n${url}`);
}

// "[Coordinator] thinks this is a fit for you: [task]. A yes, no, or
// not-now are all fine — reply within [N days]." — see docs/spec.md's
// Task assignment notification. The first real click-to-act email this
// app sends — every prior notification stayed a visible in-app flag,
// deliberately, since nothing needed one-click action before this (see
// docs/development-plan.md's Phase 51). Each of the three URLs already
// carries its own single-use, single-action token — see
// src/lib/notifications/action-tokens.ts — so clicking one needs no
// login and can't be repurposed into a different response.
export async function sendTaskNominationEmail(
  email: string,
  input: {
    nominatorName: string;
    taskTitle: string;
    message: string | null;
    responseDays: number;
    acceptUrl: string;
    declineUrl: string;
    notNowUrl: string;
  },
) {
  const subject = `${input.nominatorName} thinks "${input.taskTitle}" is a fit for you`;
  const text = [
    `${input.nominatorName} thinks this is a fit for you: ${input.taskTitle}`,
    input.message ? `\n"${input.message}"` : null,
    `\nA yes, no, or not-now are all fine — reply within ${input.responseDays} day${input.responseDays === 1 ? "" : "s"}.`,
    `\nAccept: ${input.acceptUrl}`,
    `Not for me: ${input.declineUrl}`,
    `Not right now: ${input.notNowUrl}`,
    `\nNo response by the deadline releases it back to Unclaimed automatically — no penalty either way.`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  await sendPlainTextEmail(
    email,
    subject,
    text,
    `task nomination for ${email} ("${input.taskTitle}"):\nAccept: ${input.acceptUrl}\nNot for me: ${input.declineUrl}\nNot right now: ${input.notNowUrl}`,
  );
}

// "Confirm this address receives mail" — the last step before a member
// points their delivery at it, and therefore everything
// `contact_method.verified_at` is asserting. One action, one URL, and no
// login needed to read it: the token carries the member id, so this points
// at /profile?verify=… rather than a route of its own, and the profile
// consumes the token on arrival.
export async function sendEmailVerificationEmail(email: string, url: string) {
  const subject = "Confirm this email address";
  const text = [
    `Someone asked to make ${email} the address Orchard emails them at.`,
    ``,
    `Confirm it here:`,
    url,
    ``,
    `The link works once and lasts a day. If you didn't ask for this, ignore it — the address stays exactly as it was.`,
  ].join("\n");
  await sendPlainTextEmail(email, subject, text, `email verification for ${email}:\n${url}`);
}

// A plain outbound message (targeted or community-wide announcement) —
// see docs/spec.md's Outbound communications and
// docs/development-plan.md's Phase 53. One-way, no action tokens: "a
// plain message has nothing to click," unlike the task-nomination
// email above.
export async function sendOutboundMessageEmail(
  email: string,
  input: { senderName: string; subject: string; body: string },
) {
  const text = `From ${input.senderName}:\n\n${input.body}`;
  await sendPlainTextEmail(email, input.subject, text, `outbound message for ${email}: "${input.subject}"`);
}

// D7 (docs/cycle-scope-remediation-plan.md §4.7) — the one backstop
// notification: a critical task in the backstop's scope has hard-flagged.
// Informational, no action token: the backstop's own job is to get it
// moving, which the ordinary claim path already lets them do; this email
// just tells them it happened.
export async function sendBackstopHardFlagEmail(
  email: string,
  input: { taskTitle: string; taskUrl: string },
) {
  const subject = `Critical task hard-flagged: ${input.taskTitle}`;
  const text = [
    `A critical task in your backstop scope has hard-flagged — no owner, past the point its deadline tolerates:`,
    `\n${input.taskTitle}`,
    `\nAs this scope's backstop, getting it moving is yours: claim it yourself or find it an owner. It stays open and claimable by anyone until then.`,
    `\n${input.taskUrl}`,
  ].join("\n");
  await sendPlainTextEmail(email, subject, text, `backstop hard flag ("${input.taskTitle}"):\n${input.taskUrl}`);
}

// docs/joining-admission-plan.md §2.4's "poke": the inviter of a
// nomination names the members they think also know the invitee, and
// those members each get one email carrying the support link. No action
// token and no per-person state here, unlike the task-nomination email
// above — because "you've been asked to support {name}" has exactly one
// action (open the link, say how you know them) and supporting is
// idempotent by construction (src/lib/recruitment/support.ts's
// recordSupport upserts in place). A token would buy nothing and would
// expire a link the invitee is still relying on.
//
// Deliberately one email per named person rather than one broadcast: the
// plan is explicit that "nothing broadcasts the nominee's existence
// beyond who the inviter chose", and a BCC would break that.
export async function sendNominationSupportRequestEmail(
  email: string,
  input: { askerName: string; nomineeLabel: string | null; supportUrl: string; windowHours: number; onBehalfOfCommunity: boolean },
) {
  const subject = `${input.askerName} asked you to vouch for someone${input.nomineeLabel ? ` (${input.nomineeLabel})` : ""}`;
  const text = [
    `${input.askerName} has asked you to support someone's join${input.nomineeLabel ? `: ${input.nomineeLabel}` : ""}.`,
    ``,
    `If you know them, or you'd expect them to fit, this link is all it takes:`,
    `${input.supportUrl}`,
    ``,
    `You'll be asked to say how you know them. Nothing about this is broadcast, and nobody is told who you supported unless they support it themselves.`,
    `If nobody gets round to it within ${input.windowHours} hours, nothing happens to them — the request just lapses and they carry on.${input.onBehalfOfCommunity ? " They're also waiting on the community's own application process, so this is a bonus, not a gate." : ""}`,
  ].join("\n");
  await sendPlainTextEmail(email, subject, text, `nomination support request for ${email}:\n${input.supportUrl}`);
}

// The two emails a person in the admission funnel always gets
// (docs/admission-flow.md §6): that we have them, with the private link to
// follow where they are, and that they are in. Nothing else is sent to
// someone who is not yet a member, so these are deliberately plain and each
// carries only what that moment needs. The link is the arrival's own token
// (§4) — the one place they can see where they are, and nobody else can.
export async function sendAdmissionReceivedEmail(
  email: string,
  input: { name: string; communityName: string; statusUrl: string },
) {
  const subject = `We have your application to ${input.communityName}`;
  const text = [
    `Hello ${input.name},`,
    ``,
    `${input.communityName} has your request to join. You don't need to do anything now unless the page below says so.`,
    ``,
    `This link is yours — it shows where things are, and what happens next:`,
    `${input.statusUrl}`,
    ``,
    `Please keep it to yourself; anyone who has it can see your progress.`,
  ].join("\n");
  await sendPlainTextEmail(email, subject, text, `admission received for ${email}:\n${input.statusUrl}`);
}

export async function sendAdmissionAcceptedEmail(
  email: string,
  input: { name: string; communityName: string; statusUrl: string; loginUrl: string },
) {
  const subject = `You're in — welcome to ${input.communityName}`;
  const text = [
    `Hello ${input.name},`,
    ``,
    `You've been accepted into ${input.communityName}.`,
    ``,
    `To sign in, request a login link here with this email address:`,
    `${input.loginUrl}`,
    ``,
    `Your progress page, if you want to look back at it:`,
    `${input.statusUrl}`,
  ].join("\n");
  await sendPlainTextEmail(email, subject, text, `admission accepted for ${email}:\n${input.statusUrl}`);
}
