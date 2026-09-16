import { updateTaskColor, taskHandler } from '../../../lib/tasks-server';
export async function PATCH(request: Request) { return taskHandler(() => updateTaskColor(request)); }
