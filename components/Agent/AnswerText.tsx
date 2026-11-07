import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * The assistant's answer. The model wrote it, and the model reads contract text
 * that can be hostile, so it is never shown as HTML. react-markdown turns markdown
 * into elements itself and treats raw HTML as plain text; links and images are
 * also removed, so a manipulated answer can't send the couple anywhere or load
 * anything. Tables, lists and bold are kept: answers use them.
 */
export function AnswerText({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        disallowedElements={["a", "img", "iframe", "script", "style"]}
        unwrapDisallowed
        components={{
          p: ({ children }) => <p>{children}</p>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border-b border-neutral-300 px-2 py-1 font-semibold">{children}</th>,
          td: ({ children }) => <td className="border-b border-neutral-200 px-2 py-1">{children}</td>,
          code: ({ children }) => <code className="rounded bg-neutral-100 px-1">{children}</code>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
