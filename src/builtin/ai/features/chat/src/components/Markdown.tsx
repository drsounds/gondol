import { Fragment, useMemo, type ReactNode } from "react";
import { parseMarkdown, type MdBlock, type MdInline } from "../../../../models/markdown";

/**
 * An answer's markdown, formatted (models/markdown.ts parses it). Everything is a React element, so
 * nothing in the text is ever read as HTML; links open in a new tab.
 */
export function Markdown({ source }: { source: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return <div className="ai-markdown">{renderBlocks(blocks)}</div>;
}

function renderBlocks(blocks: MdBlock[]): ReactNode {
  return blocks.map((block, index) => <Fragment key={index}>{renderBlock(block)}</Fragment>);
}

function renderBlock(block: MdBlock): ReactNode {
  switch (block.type) {
    case "heading": {
      const Tag = `h${Math.min(block.level + 2, 6)}` as "h3" | "h4" | "h5" | "h6";
      return <Tag className={`ai-markdown__h${block.level}`}>{renderInline(block.children)}</Tag>;
    }
    case "paragraph":
      return <p>{renderInline(block.children)}</p>;
    case "code":
      return (
        <pre className="ai-markdown__pre" data-lang={block.lang || undefined}>
          {block.lang ? <span className="ai-markdown__lang">{block.lang}</span> : null}
          <code>{block.text}</code>
        </pre>
      );
    case "quote":
      return <blockquote>{renderBlocks(block.children)}</blockquote>;
    case "list": {
      const items = block.items.map((item, index) => (
        <li key={index} className={item.checked === null ? undefined : "ai-markdown__task"}>
          {item.checked === null ? null : <input type="checkbox" checked={item.checked} readOnly disabled aria-hidden="true" />}
          {renderListItem(item.children)}
        </li>
      ));
      return block.ordered ? <ol start={block.start === 1 ? undefined : block.start}>{items}</ol> : <ul>{items}</ul>;
    }
    case "table":
      return (
        <div className="ai-markdown__table">
          <table>
            <thead>
              <tr>
                {block.head.map((cell, column) => (
                  <th key={column} style={block.align[column] ? { textAlign: block.align[column]! } : undefined}>
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, column) => (
                    <td key={column} style={block.align[column] ? { textAlign: block.align[column]! } : undefined}>
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "rule":
      return <hr />;
  }
}

/** A tight item (one paragraph) shows its text without a paragraph around it. */
function renderListItem(children: MdBlock[]): ReactNode {
  if (children[0]?.type === "paragraph") {
    return (
      <>
        {renderInline(children[0].children)}
        {renderBlocks(children.slice(1))}
      </>
    );
  }
  return renderBlocks(children);
}

function renderInline(pieces: MdInline[]): ReactNode {
  return pieces.map((piece, index) => {
    switch (piece.type) {
      case "text":
        return <Fragment key={index}>{piece.text}</Fragment>;
      case "code":
        return <code key={index}>{piece.text}</code>;
      case "strong":
        return <strong key={index}>{renderInline(piece.children)}</strong>;
      case "em":
        return <em key={index}>{renderInline(piece.children)}</em>;
      case "del":
        return <del key={index}>{renderInline(piece.children)}</del>;
      case "link":
        return (
          <a key={index} href={piece.href} target="_blank" rel="noopener noreferrer nofollow">
            {renderInline(piece.children)}
          </a>
        );
      case "br":
        return <br key={index} />;
    }
  });
}
