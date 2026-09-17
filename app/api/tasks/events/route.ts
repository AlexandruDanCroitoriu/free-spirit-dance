import { taskEventChoices, taskHandler } from '../../../lib/tasks-server';
export async function GET(request: Request) { return taskHandler(() => taskEventChoices(request)); }
