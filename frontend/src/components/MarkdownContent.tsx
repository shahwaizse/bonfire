import ReactMarkdown from "react-markdown";
import { useMemo } from 'react';
import remarkGfm from "remark-gfm";
import type { SearchResultItem } from "@/lib/types";
import { faviconUrl, sourceDomain } from "@/lib/sources";

type MarkdownNode = {
  type?: string;
  value?: string;
  url?: string;
  title?: string | null;
  children?: MarkdownNode[];
};

export default function MarkdownContent({ content, sources = [], hasPictureGallery = false }: { content: string; sources?: SearchResultItem[]; hasPictureGallery?: boolean }) {
  const plugins = useMemo(() => [remarkGfm, citationPlugin(sources.length), galleryPlaceholderPlugin(hasPictureGallery)], [sources.length, hasPictureGallery]);
  return (
    <ReactMarkdown
      remarkPlugins={plugins}
      disallowedElements={["img"]}
      components={{
        table({ children }) {
          return <div className="chat-table-scroll" role="region" aria-label="Table" tabIndex={0}><table>{children}</table></div>;
        },
        a({ href, children }) {
          const citation = citationIndex(href);
          if (citation !== null && sources[citation]) return <CitationLink source={sources[citation]} />;
          return (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function galleryPlaceholderPlugin(enabled: boolean) {
  return () => (tree: MarkdownNode) => {
    if (!enabled) return;
    const visit = (node: MarkdownNode) => {
      if (node.type === 'code' || node.type === 'inlineCode') return;
      if ((node.type === 'text' || node.type === 'html') && node.value) {
        node.value = node.value.replace(/(?:<|&lt;)\s*\/?(?:pictures?|images?)[\s_-]+gallery\s*\/?\s*(?:>|&gt;)/gi, '');
      }
      node.children?.forEach(visit);
      if (node.children) node.children = node.children.filter(child => !((child.type === 'text' || child.type === 'html') && child.value === '') && !(child.type === 'paragraph' && !child.children?.length));
    };
    visit(tree);
  };
}

function CitationLink({ source }: { source: SearchResultItem }) {
  const icon = faviconUrl(source);
  const label = source.title || sourceDomain(source) || source.url;

  return (
    <a
      href={source.url}
      target="_blank"
      rel="noreferrer"
      className="mx-0.5 inline-grid size-5 place-items-center rounded-md border bg-background/75 align-[-0.2em] text-[0] shadow-sm hover:bg-muted"
      title={label}
      aria-label={`Source: ${label}`}
      data-testid="citation-favicon"
    >
      {icon && (
        <img
          src={icon}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-3.5"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      )}
    </a>
  );
}

function citationIndex(href: string | undefined) {
  if (!href?.startsWith("#bonfire-citation-")) return null;
  const index = Number(href.slice("#bonfire-citation-".length));
  return Number.isInteger(index) && index >= 0 ? index : null;
}

function citationPlugin(sourceCount: number) {
  return () => (tree: MarkdownNode) => {
    if (sourceCount > 0) replaceCitations(tree, sourceCount);
  };
}

function replaceCitations(parent: MarkdownNode, sourceCount: number) {
  if (!parent.children || skipCitationParent(parent.type)) return;
  const nextChildren: MarkdownNode[] = [];

  for (const child of parent.children) {
    if (child.type === "text" && child.value) {
      nextChildren.push(...citationNodes(child.value, sourceCount));
      continue;
    }
    replaceCitations(child, sourceCount);
    nextChildren.push(child);
  }

  parent.children = nextChildren;
}

function citationNodes(value: string, sourceCount: number) {
  const nodes: MarkdownNode[] = [];
  const citationRe = /\[(\d{1,2})\]/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = citationRe.exec(value))) {
    const sourceNumber = Number(match[1]);
    if (!Number.isInteger(sourceNumber) || sourceNumber < 1 || sourceNumber > sourceCount) continue;
    if (match.index > cursor) nodes.push({ type: "text", value: value.slice(cursor, match.index) });
    nodes.push({
      type: "link",
      url: `#bonfire-citation-${sourceNumber - 1}`,
      title: null,
      children: [{ type: "text", value: `source ${sourceNumber}` }],
    });
    cursor = match.index + match[0].length;
  }

  if (!nodes.length) return [{ type: "text", value }];
  if (cursor < value.length) nodes.push({ type: "text", value: value.slice(cursor) });
  return nodes;
}

function skipCitationParent(type: string | undefined) {
  return type === "link" || type === "linkReference" || type === "definition" || type === "code" || type === "inlineCode";
}
