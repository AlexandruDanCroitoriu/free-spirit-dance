import { moveTask, taskHandler } from '../../../lib/tasks-server';

export async function POST(request: Request) { return taskHandler(() => moveTask(request)); }
