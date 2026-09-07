import type { TaskRecord } from "../../lib/taskTree";

export interface FamilyMember {
  id: string;
  userId: string | null;
  displayName: string | null;
  name: string | null;
}

export interface TasksResponse {
  tasks: TaskRecord[];
}
