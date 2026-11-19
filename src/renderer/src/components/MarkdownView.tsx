import React, { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import hljs from "highlight.js/lib/common";
import { Check, Copy } from "lucide-react";

function CodeBlock({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const match = /language-([\w+-]+)/.exec(className || "");
  const requestedLang = match?.[1]?.toLowerCase() ?? "";
  const rawCode = String(children ?? "").replace(/\n$/, "");

  const { html, resolvedLang, lineCount } = useMemo(() => {
    const lines = rawCode ? rawCode.split("\n").length : 1;
    try {
      if (requestedLang && hljs.getLanguage(requestedLang)) {
        const res = hljs.highlight(rawCode, {
          language: requestedLang,
          ignoreIllegals: true,
        });
        return { html: res.value, resolvedLang: requestedLang, lineCount: lines };
      }
      const auto = hljs.highlightAuto(rawCode);
      return {
        html: auto.value,
        resolvedLang: requestedLang || auto.language || "code",
        lineCount: lines,
      };
    } catch {
      const escaped = rawCode
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return { html: escaped, resolvedLang: requestedLang || "code", lineCount: lines };
    }
  }, [rawCode, requestedLang]);

  const handleCopy = () => {
    void navigator.clipboard.writeText(rawCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-white/10 bg-[#0a0d14]/95">
      <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] text-slate-400">
        <span className="font-mono uppercase tracking-wider text-indigo-300/90">
          {resolvedLang}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-slate-300 transition hover:bg-white/10 hover:text-white"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-400" />
              <span className="text-emerald-300">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <div className="glass-scroll flex overflow-x-auto py-2.5 font-mono text-[12px] leading-5">
        <div
          aria-hidden="true"
          className="select-none border-r border-white/10 pr-2.5 pl-3 text-right text-[11px] leading-5 text-slate-600"
        >
          {Array.from({ length: lineCount }, (_, idx) => (
            <div key={idx}>{idx + 1}</div>
          ))}
        </div>
        <pre className="m-0 flex-1 px-3 text-slate-100">
          <code
            className="hljs block whitespace-pre font-mono text-[12px] leading-5"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </pre>
      </div>
    </div>
  );
}

export const MarkdownView = React.memo(function MarkdownView({
  content,
}: {
  content: string;
}) {
  return (
    <div className="hud-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          pre({ children }) {
            return <>{children}</>;
          },
          code({ className, children, ...props }) {
            const isBlock = Boolean(className) || String(children).includes("\n");
            if (isBlock) {
              return <CodeBlock className={className}>{children}</CodeBlock>;
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
