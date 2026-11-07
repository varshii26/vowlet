import { Children, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ClauseChip } from "@/components/Clauses/ClauseChip";
import { splitCitations, type CitationSource } from "@/lib/agent/sources";
import { clauseHref } from "@/lib/vendors/links";

/**
 * The assistant's answer. The model wrote it, and the model reads contract text
 * that can be hostile, so it is never shown as HTML. react-markdown turns markdown
 * into elements itself and treats raw HTML as plain text; links and images are
 * also removed, so a manipulated answer can't send the couple anywhere or load
 * anything. Tables, lists and bold are kept: answers use them.
 *
 * Clause citations become chips that open the clause, but only citations a tool
 * returned during this run (`sources`), with the clause id that tool looked up.
 * Their links are built by us from those ids, never taken from the answer.
 */
export function AnswerText({ text, sources = [] }: { text: string; sources?: CitationSource[] }) {
  const chips = (children: ReactNode): ReactNode =>
    sources.length === 0
      ? children
      : Children.map(children, (child) =>
          typeof child === "string"
            ? splitCitations(child, sources).map((part, i) =>
                typeof part === "string" ? (
                  part
                ) : (
                  <ClauseChip key={`${part.clauseId}-${i}`} label={part.label} clause={part.text && part.page ? { text: part.text, page: part.page } : null} href={clauseHref(part.vendorId, part.clauseId)} />
                ),
              )
            : child,
        );

  return (
    <div className="space-y-2 text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        disallowedElements={["a", "img", "iframe", "script", "style"]}
        unwrapDisallowed
        components={{
          p: ({ children }) => <p>{chips(children)}</p>,
          strong: ({ children }) => <strong className="font-semibold">{chips(children)}</strong>,
          em: ({ children }) => <em>{chips(children)}</em>,
          li: ({ children }) => <li>{chips(children)}</li>,
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border-b border-neutral-300 px-2 py-1 font-semibold">{chips(children)}</th>,
          td: ({ children }) => <td className="border-b border-neutral-200 px-2 py-1">{chips(children)}</td>,
          code: ({ children }) => <code className="rounded bg-neutral-100 px-1">{children}</code>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
