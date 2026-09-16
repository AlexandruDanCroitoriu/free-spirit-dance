import { taskHandler, updateTaskViewPreference } from '../../../lib/tasks-server';

export async function PATCH(request: Request) { return taskHandler(() => updateTaskViewPreference(request)); }
