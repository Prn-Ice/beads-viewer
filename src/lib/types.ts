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
  is_template?: boolean | null;
  ephemeral?: boolean | null;
  no_history?: boolean | null;
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
  source: "local" | "github";
  /** True when the checkout is a linked git worktree (local projects only). */
  worktree?: boolean;
  summary: ProjectSummary | null;
}

export interface IssueListResponse {
  issues: BeadsIssue[];
  readyIds: string[];
}

export interface GithubRepoRef {
  slug: string; // "owner/repo"
}

export type GithubRepoResponse =
  | { slug: string; state: "ok"; project: Project }
  | { slug: string; state: "empty" } // repo has no beads project
  | { slug: string; state: "error"; message: string };
