import { renameTaskList, removeTaskList, taskHandler } from '../../../../lib/tasks-server';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return taskHandler(async () => renameTaskList(request, (await params).id));
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return taskHandler(async () => removeTaskList(request, (await params).id));
}
