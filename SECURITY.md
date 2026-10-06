# Security policy

Orchard holds information about the people in a community: names and contact details, answers to sensitive profile questions, conflict reports, and who may read what. A security problem here can hurt people, not just a deployment, so please report one privately rather than in a public issue.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: on the repository, open the **Security** tab and choose **Report a vulnerability**. That reaches the maintainers without making the report public.

Please include what you found, how to reproduce it, and which version or commit you were looking at. If it involves a running instance, say so rather than testing against one you don't operate.

This is a volunteer-maintained project, so there is no response-time guarantee, but a report that arrives privately will be read and answered, and you'll be told when it's fixed. Please give us the chance to fix it before disclosing it publicly.

## What is in scope

Anything that lets a person see, change or do something the application says they shouldn't be able to. The areas where that matters most:

- **Access control**: who can read a profile answer, a contact method, or a conflict report; who can change settings, grant permissions or confirm a tier; and the read-only guarantee of View-as.
- **Authentication**: magic-link and single-sign-on login, session handling, invite and support tokens.
- **Anything that exposes another member's data**, including through an API route rather than a page.

Dependency advisories are tracked automatically (see `.github/dependabot.yml`); you don't need to report one unless you've found it to be exploitable in Orchard specifically.

## Supported versions

Orchard is pre-1.0. Only the latest tagged release, and `main`, receive fixes. Upgrading is a matter of pulling the new image or source and letting the migrations run; take a database backup first (see [`CONTRIBUTING.md`](CONTRIBUTING.md#releases-and-upgrading)).

## If you run an instance

- Keep `SESSION_SECRET` long, random and private. Rotating it signs everyone out.
- Keep the application behind HTTPS (the bundled Caddy configuration does this).
- Back up the database before upgrading.
