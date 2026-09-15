import { refreshTasks } from '../../../lib/task-rules-server';
import { taskHandler } from '../../../lib/tasks-server';

export async function POST(request: Request) { return taskHandler(() => refreshTasks(request)); }
