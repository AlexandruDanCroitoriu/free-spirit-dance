import { createTask, getTasks, taskHandler } from '../../lib/tasks-server';

export async function GET(request: Request) { return taskHandler(() => getTasks(request)); }
export async function POST(request: Request) { return taskHandler(() => createTask(request)); }
