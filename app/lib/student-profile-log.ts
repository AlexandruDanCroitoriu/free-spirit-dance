export function studentLogActor(request: Request) {
  const email = request.headers.get("cf-access-authenticated-user-email")?.trim().toLowerCase();
  if (email) return email;
  return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname) ? "administrator@local" : null;
}

export const profileFields = {
  first_name: "First name", last_name: "Last name", email: "Email", phone: "Phone",
  birth_date: "Birth date", facebook_url: "Facebook", instagram_url: "Instagram",
  picture: "Profile photo", active: "Status",
} as const;

export type ProfileField = keyof typeof profileFields;
export type ProfileValues = { first_name: string; last_name: string; email: string; phone: string; birth_date: string | null; facebook_url: string; instagram_url: string; picture: string | null; active: number };

export function changedProfileFields(before: ProfileValues, after: ProfileValues) {
  return (Object.keys(profileFields) as ProfileField[]).filter(field => before[field] !== after[field]);
}

export function logValue(field: ProfileField, value: string | number | null) {
  if (field === "picture") return value ? "Photo set" : "No photo";
  if (field === "active") return value ? "Active" : "Inactive";
  return value === null || value === "" ? null : String(value);
}
