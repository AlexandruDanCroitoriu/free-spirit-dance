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

## Development

- Use the existing Vinext, React, TypeScript, and Cloudflare setup.
- Keep changes focused and follow the patterns already present in `app/`.
- Run `npm run build` to verify production builds.
- Run `npm run dev` for local development.
