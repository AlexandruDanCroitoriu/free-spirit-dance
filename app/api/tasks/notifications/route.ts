import { assignedTaskNotifications, taskHandler } from '../../../lib/tasks-server';

export function GET(request: Request) { return taskHandler(() => assignedTaskNotifications(request)); }
