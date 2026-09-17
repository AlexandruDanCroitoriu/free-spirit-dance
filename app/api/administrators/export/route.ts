import { env } from "../../../lib/storage";

const ownerEmail = "croitoriu.alexandru.code@gmail.com";
// Keep this list aligned with migrations. D1's local development runtime blocks
// PRAGMA table_info, so the export cannot discover columns at request time.
export const tableColumns = {
  task_boards: ["id", "name", "request_key", "created_at", "owner_email", "color"],
  task_lists: ["id", "board_id", "name", "sort_order", "request_key", "created_at", "color"],
  task_preferences: ["email", "inbox_color", "selected_board_scope"],
  task_board_state: ["id", "revision"],
  task_students: ["task_id", "student_id"],
  task_courses: ["task_id", "course_id"],
  task_free_events: ["task_id", "event_id"],
  task_free_meetings: ["task_id", "meeting_id"],
  task_images: ["id", "task_id", "owner_email", "object_key", "created_at", "expires_at"],
  manual_tasks: ["id", "title", "description", "due_date", "sort_order", "created_by", "created_at", "updated_by", "updated_at", "request_key", "request_payload", "list_id", "inbox_owner", "administrator_emails", "assigned_to", "status"],
  admin_profiles: ["email", "name", "picture"],
  administrator_payment_methods: ["email", "method"],
  administrator_permissions: ["email", "can_dashboard", "can_students", "can_courses", "can_qr_codes", "can_practice_parties", "can_free_events", "can_tasks"],
  attendance: ["id", "student_id", "course_id", "course_name", "attended_at", "recorded_by", "recorded_at", "notes", "request_key", "request_payload", "class_id", "complimentary", "complimentary_by", "complimentary_at"],
  free_missed_attendance: ["id", "student_id", "class_id", "granted_by", "granted_at", "notes"],
  free_events: ["id", "name", "starts_on", "ends_on", "image_path", "revision", "created_by", "created_at", "updated_at"],
  free_event_meetings: ["id", "event_id", "name", "starts_at", "starts_utc", "duration_minutes", "space_rent_minor", "accepts_donations", "cancelled", "revision", "created_by", "created_at", "updated_at"],
  free_event_attendance: ["id", "meeting_id", "student_id", "recorded_by", "recorded_at", "donation_amount_minor", "donation_received_method", "donation_given_to_school"],
  free_event_change_log: ["id", "event_id", "administrator_email", "action", "before_json", "after_json", "created_at"],
  free_meeting_change_log: ["id", "meeting_id", "administrator_email", "action", "before_json", "after_json", "created_at"],
  classes: ["id", "course_id", "class_date", "start_time", "end_time", "cancelled", "cancelled_by", "cancelled_at", "rent_cost_minor", "rent_paid", "location", "created_by"],
  class_change_log: ["id", "class_id", "administrator_email", "action", "field", "old_value", "new_value", "student_name", "created_at"],
  course_schedule: ["id", "course_id", "day_of_week", "start_time", "end_time", "rent_cost_minor"],
  courses: ["id", "name", "start_date", "end_date", "class_cost_minor"],
  payment_students: ["payment_id", "student_id"],
  payment_course_allowances: ["payment_id", "course_id", "course_name", "allowance"],
  payment_preset_courses: ["preset_id", "course_id", "allowance"],
  payment_presets: ["id", "name", "amount_minor", "course_id", "student_count"],
  payment_transfer_filters: ["id", "administrator_email", "collector_email", "collector_emails", "from_date", "to_date", "payment_kind", "payment_types", "sort_order", "created_at"],
  practice_attendance: ["id", "student_id", "practice_id", "recorded_by", "recorded_at", "notes", "donation_amount_minor", "donation_paid_on", "donation_notes", "donation_recorded_by", "donation_recorded_at", "donation_given_to_school", "donation_received_method"],
  practice_parties: ["id", "starts_at", "starts_utc", "duration_minutes", "cancelled", "revision", "recorded_by", "recorded_at", "request_key", "request_hash", "last_request_key", "last_request_hash", "location", "rent_cost_minor", "rent_paid"],
  qr_codes: ["id", "slug", "name", "destination_url", "active", "image_mode", "image_path", "module_shape", "foreground_color", "eye_shape", "eye_color", "logo_size", "logo_shape"],
  student_courses: ["student_id", "course_id"],
  student_profile_log: ["id", "student_id", "administrator_email", "action", "field", "old_value", "new_value", "created_at"],
  student_payments: ["id", "student_id", "paid_on", "amount_minor", "notes", "recorded_by", "recorded_at", "request_key", "request_payload", "given_to_school", "received_method", "student_count"],
  students: ["id", "first_name", "last_name", "email", "phone", "picture", "active", "birth_date", "facebook_url", "instagram_url"],
} as const;

type TableRow = Record<string, unknown>;
export type ExportTable = { name: string; columns: string[]; rows: TableRow[] };

function canExport(request: Request) {
  const hostname = new URL(request.url).hostname;
  const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  const email = request.headers.get("cf-access-authenticated-user-email")?.trim().toLowerCase();
  return local || email === ownerEmail;
}

export async function readExportTables() {
  const tables = Object.entries(tableColumns);
  const data = await env.DB.batch(tables.map(([name, columns]) => env.DB.prepare(`SELECT ${columns.map((column) => `"${column}"`).join(", ")} FROM "${name}"`)));
  return tables.map(([name, columns], index) => ({ name, columns: [...columns], rows: data[index].results as TableRow[] })) satisfies ExportTable[];
}

export async function GET(request: Request) {
  if (!canExport(request)) return Response.json({ error: "Only the main administrator can export the database." }, { status: 403 });
  try {
    return Response.json({ tables: await readExportTables() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not export database", error);
    return Response.json({ error: "Could not export the database." }, { status: 500 });
  }
}

// Preserve compatibility with exports from before named boards/lists existed.
export function upgradeTaskTables(input: unknown): unknown {
  if (!Array.isArray(input)) return input;
  // Ignore retired generated-task tables in older exports.
  const result = input.filter(table => !['automatic_task_occurrences', 'task_rule_state'].includes(table?.name)).map(table => {
    if (table?.name !== 'manual_tasks' || !Array.isArray(table.columns) || !Array.isArray(table.rows)) return table;
    const expected = tableColumns.manual_tasks;
    if ([expected.length - 1, expected.length - 3].includes(table.columns.length) && table.columns.every((column: unknown, index: number) => column === expected[index])) return { ...table, columns: [...expected], rows: table.rows.map((row: Record<string, unknown>) => ({ administrator_emails: '[]', assigned_to: null, ...row, status: 'in_progress' })) };
    const legacy = ['id', 'title', 'description', 'due_date', 'status', 'student_id', 'sort_order', 'created_by', 'created_at', 'updated_by', 'updated_at', 'request_key', 'request_payload', 'list_id', 'inbox_owner'];
    const old = table.columns.length >= 13 && table.columns.length <= 15 && table.columns.every((column: unknown, index: number) => column === legacy[index]);
    if (!old) return table;
    return { ...table, columns: [...expected], rows: table.rows.map((row: Record<string, unknown>) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
      const { status: _status, student_id: _student, ...rest } = row;
      return { ...rest, list_id: Object.hasOwn(row, 'list_id') ? row.list_id : 1, inbox_owner: row.inbox_owner ?? null, administrator_emails: '[]', assigned_to: null, status: _status === 'done' ? 'done' : 'in_progress' };
    }) };
  });
  if (!result.some(table => table?.name === 'task_students')) {
    const oldTasks = input.find(table => table?.name === 'manual_tasks');
    const rows = Array.isArray(oldTasks?.rows) && oldTasks.columns?.includes('student_id') ? oldTasks.rows.filter((row: Record<string, unknown>) => row?.student_id != null).map((row: Record<string, unknown>) => ({ task_id: row.id, student_id: row.student_id })) : [];
    result.push({ name: 'task_students', columns: [...tableColumns.task_students], rows });
  }
  if (!result.some(table => table?.name === 'task_courses')) result.push({name: 'task_courses', columns: [...tableColumns.task_courses], rows: []});
  if (!result.some(table => table?.name === 'task_free_events')) result.push({name: 'task_free_events', columns: [...tableColumns.task_free_events], rows: []});
  if (!result.some(table => table?.name === 'task_free_meetings')) result.push({name: 'task_free_meetings', columns: [...tableColumns.task_free_meetings], rows: []});
  if (!result.some(table => table?.name === 'task_images')) result.push({name: 'task_images', columns: [...tableColumns.task_images], rows: []});
  if (!result.some(table => table?.name === 'task_boards')) result.push({ name: 'task_boards', columns: [...tableColumns.task_boards], rows: [{ id: 1, name: 'School', owner_email: null, color: 'default', request_key: null, created_at: '1970-01-01T00:00:00Z' }] });
  if (!result.some(table => table?.name === 'task_lists')) result.push({ name: 'task_lists', columns: [...tableColumns.task_lists], rows: [{ id: 1, board_id: 1, name: 'Tasks', color: 'default', sort_order: 0, request_key: null, created_at: '1970-01-01T00:00:00Z' }] });
  const boards = result.find(table => table?.name === 'task_boards');
  if (Array.isArray(boards?.columns) && boards.columns.length === 4 && boards.columns.every((column: unknown, index: number) => column === tableColumns.task_boards[index]) && Array.isArray(boards.rows)) {
    boards.columns = [...tableColumns.task_boards];
    boards.rows = [{ id: 1, name: 'School', owner_email: null, color: 'default', request_key: null, created_at: '1970-01-01T00:00:00Z' }];
    const lists = result.find(table => table?.name === 'task_lists');
    if (Array.isArray(lists?.rows)) lists.rows = lists.rows.map((row: unknown, index: number) => row && typeof row === 'object' && !Array.isArray(row) ? { ...row, board_id: 1, sort_order: index } : row);
  }
  for (const name of ['task_boards', 'task_lists'] as const) {
    const table = result.find(table => table?.name === name), expected = tableColumns[name];
    if (Array.isArray(table?.columns) && table.columns.length === expected.length - 1 && table.columns.every((column: unknown, index: number) => column === expected[index]) && Array.isArray(table.rows)) {
      table.columns = [...expected];
      table.rows = table.rows.map((row: unknown) => row && typeof row === 'object' && !Array.isArray(row) ? {...row, color: 'default'} : row);
    }
  }
  const classes = result.find(table => table?.name === 'classes');
  if (Array.isArray(classes?.columns) && classes.columns.length === tableColumns.classes.length - 1 && classes.columns.every((column: unknown, index: number) => column === tableColumns.classes[index]) && Array.isArray(classes.rows)) {
    const firstAttendance = new Map<number, { by: string; at: string; id: number }>();
    const attendance = result.find(table => table?.name === 'attendance');
    for (const row of Array.isArray(attendance?.rows) ? attendance.rows : []) {
      if (typeof row?.class_id !== 'number' || typeof row.recorded_by !== 'string') continue;
      const at = typeof row.recorded_at === 'string' ? row.recorded_at : String(row.attended_at ?? '');
      const id = typeof row.id === 'number' ? row.id : 0;
      const previous = firstAttendance.get(row.class_id);
      if (!previous || at < previous.at || (at === previous.at && id < previous.id)) firstAttendance.set(row.class_id, { by: row.recorded_by, at, id });
    }
    classes.columns = [...tableColumns.classes];
    classes.rows = classes.rows.map((row: Record<string, unknown>) => row && typeof row === 'object' && !Array.isArray(row) ? { ...row, created_by: firstAttendance.get(Number(row.id))?.by ?? null } : row);
  }
  if (!result.some(table => table?.name === 'task_preferences')) result.push({name: 'task_preferences', columns: [...tableColumns.task_preferences], rows: []});
  // Older exports represent single-student payments and presets.
  for (const name of ['payment_presets', 'student_payments'] as const) {
    const table = result.find(table => table?.name === name), expected = tableColumns[name];
    if (Array.isArray(table?.columns) && table.columns.length === expected.length - 1 && table.columns.every((column: unknown, index: number) => column === expected[index]) && Array.isArray(table.rows)) {
      table.columns = [...expected];
      table.rows = table.rows.map((row: Record<string, unknown>) => ({ ...row, student_count: 1 }));
    }
  }
  if (!result.some(table => table?.name === 'payment_students')) result.push({ name: 'payment_students', columns: [...tableColumns.payment_students], rows: [] });
  if (!result.some(table => table?.name === 'student_profile_log')) result.push({ name: 'student_profile_log', columns: [...tableColumns.student_profile_log], rows: [] });
  if (!result.some(table => table?.name === 'class_change_log')) result.push({ name: 'class_change_log', columns: [...tableColumns.class_change_log], rows: [] });
  return result;
}
