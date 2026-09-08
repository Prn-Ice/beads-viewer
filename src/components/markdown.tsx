import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose max-w-none prose-headings:font-semibold prose-headings:tracking-tight prose-h1:text-4xl prose-h1:leading-10 prose-h2:text-2xl prose-h2:leading-8 dark:prose-invert">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
