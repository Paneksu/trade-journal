import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cx } from "@/lib/classes";

/**
 * Markdown z AI i notatek (plan fazy 5, „Bezpieczeństwo”): `react-markdown` + `remark-gfm`, BEZ surowego
 * HTML (brak `rehype-raw`; react-markdown pokazuje znaczniki HTML jako tekst). Linki tylko http(s) i
 * względne, zawsze z `rel="noopener noreferrer"`. Słów użytkownika tym NIE renderujemy: one idą dosłownie
 * jako tekst (`whitespace-pre-wrap`), bo markdown zmieniłby ich wygląd (MUST 13).
 */
/**
 * Dozwolone adresy linków: http(s), ścieżka względna od `/` i kotwica. Odrzuca `//host` i `/\host` (adres bez
 * protokołu prowadzi na obcą domenę; code review fazy 5, 16.10.2026) oraz `javascript:` i każdy inny protokół.
 */
export function bezpiecznyAdres(url: string): string {
  return /^(https?:\/\/|\/(?![\/\\])|#)/i.test(url) ? url : "";
}

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cx(
        "space-y-3 text-karta leading-relaxed text-text",
        "[&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 [&_code]:num [&_code]:rounded [&_code]:bg-surface-3 [&_code]:px-1 [&_code]:text-meta",
        "[&_li]:ml-5 [&_ol]:list-decimal [&_strong]:font-semibold [&_ul]:list-disc [&_h1]:text-sekcja [&_h2]:text-sekcja [&_h3]:font-semibold",
        "[&_table]:w-full [&_td]:border-b [&_td]:border-line [&_td]:py-1 [&_th]:border-b [&_th]:border-line [&_th]:py-1 [&_th]:text-left [&_th]:font-normal [&_th]:text-muted",
        "[&_blockquote]:border-l-2 [&_blockquote]:border-line-strong [&_blockquote]:pl-3 [&_blockquote]:text-muted",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml={false}
        urlTransform={bezpiecznyAdres}
        components={{
          a: ({ href, children: c }) => (
            <a href={href} rel="noopener noreferrer" target={href?.startsWith("http") ? "_blank" : undefined}>
              {c}
            </a>
          ),
          img: () => null,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
