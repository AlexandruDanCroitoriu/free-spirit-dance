import { moveTaskList, taskHandler } from '../../../../lib/tasks-server';
export async function POST(request: Request) { return taskHandler(() => moveTaskList(request)); }
