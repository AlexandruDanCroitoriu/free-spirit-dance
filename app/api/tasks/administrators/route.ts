import { taskAdministrators, taskHandler } from '../../../lib/tasks-server';

export function GET(request: Request) { return taskHandler(() => taskAdministrators(request)); }
