export interface DependencyRef {
  issue_id?: string;
  depends_on_id?: string;
  type?: string;
  dependency_type?: string;
  priority?: number;
  issue_type?: string;
  id?: string;
  title?: string;
  status?: string;
}

export interface Comment {
  id: string;
  issue_id: string;
  author: string;
  text: string;
  created_at: string;
}

export interface BeadsIssue {
  id: string;
  title: string;
  description?: string;
  acceptance_criteria?: string;
  notes?: string;
  status: string;
  priority?: number;
  issue_type?: string;
  assignee?: string;
  owner?: string;
  created_at?: string;
  created_by?: string;
  updated_at?: string;
  started_at?: string;
  closed_at?: string;
  close_reason?: string;
  labels?: string[];
  dependencies?: DependencyRef[];
  dependents?: DependencyRef[];
  dependency_count: number;
  dependent_count: number;
  comment_count: number;
  parent?: string;
  defer_until?: string | null;
  due_at?: string | null;
  pinned?: boolean | null;
  metadata?: Record<string, string> | null;
}

export interface ProjectSummary {
  total_issues: number;
  open_issues: number;
  in_progress_issues: number;
  blocked_issues: number;
  closed_issues: number;
  deferred_issues: number;
  ready_issues: number;
  pinned_issues: number;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  summary: ProjectSummary | null;
}

export interface IssueListResponse {
  issues: BeadsIssue[];
  readyIds: string[];
}
