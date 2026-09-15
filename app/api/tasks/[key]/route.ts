import { deleteTask, getTasks, taskHandler, updateTask } from '../../../lib/tasks-server';

type Context = { params: Promise<{ key: string }> };
export async function GET(request: Request, context: Context) { return taskHandler(async () => getTasks(request, (await context.params).key)); }
export async function PATCH(request: Request, context: Context) { return taskHandler(async () => updateTask(request, (await context.params).key)); }
export async function DELETE(request: Request, context: Context) { return taskHandler(async () => deleteTask(request, (await context.params).key)); }
