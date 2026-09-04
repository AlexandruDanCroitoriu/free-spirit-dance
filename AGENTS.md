# Free Spirit Dance

Free Spirit Dance is a Brazilian Zouk dance school. This app is an admin-only student management tool.

## Product Context

- School administrators manage the student directory.
- Admins can add students and update their profiles.
- Student profiles support a profile image, first name, last name, phone number, email, and additional details.
- Treat student information and images as private personal data. Preserve existing data when editing and validate user-provided fields.
- Keep the interface clear, warm, and practical for frequent administrative use.

## Production Architecture

- Deploy the app to Cloudflare Workers automatically when changes are pushed to GitHub.
- Use Cloudflare D1 (SQLite) for database storage.
- Use Cloudflare R2 for student profile images.
- Compress images to a very small size in client-side JavaScript before uploading them to keep R2 storage usage low.

## Authentication

- Protect the deployed Worker with a Cloudflare Access self-hosted application.
- Use Google as the Access identity provider. Administrators authenticate with their Google accounts; the app does not store Google passwords.
- Control access with a Cloudflare Access Allow policy containing the administrators' exact Google email addresses.
- The Access application should cover the complete application hostname, with an empty path field, so all routes are protected.
- For local development, run the app through the named Cloudflare Tunnel `free-spirit-dance-local` at `https://dev-free-spirit-dance.alexandru-croitoriu.dev`. The tunnel forwards to `http://localhost:3000`, and this hostname must also be included in the Access application.
- `npm run dev` starts both Vinext and the local tunnel. `cloudflared` must be installed and authenticated, and the local tunnel configuration and credentials remain outside the repository.
- The sidebar and Settings page read the authenticated email from `/cdn-cgi/access/get-identity`. This endpoint is provided by Cloudflare Access and returns `404` on plain `localhost` development, where the UI uses its local fallback.
- Never commit Google OAuth client secrets, tunnel credentials, or the local `cloudflared` configuration to Git.

## Development

- Use the existing Vinext, React, TypeScript, and Cloudflare setup.
- Keep changes focused and follow the patterns already present in `app/`.
- Run `npm run build` to verify production builds.
- Run `npm run dev` for local development.
