import { Fragment } from 'react';
import { parseLegalText } from '../utils/legal';

// The browser's default link blue is barely legible on the dark background.
export const LINK_STYLE = { color: 'var(--md-primary)' } as const;

/** Renders maintained plain text as React nodes: paragraphs, line breaks, links. */
export default function LegalText({ text }: { text: string }) {
  return (
    <>
      {parseLegalText(text).map((lines, pi) => (
        <p key={pi} style={{ margin: '0 0 12px', lineHeight: 1.6 }}>
          {lines.map((segments, li) => (
            <Fragment key={li}>
              {li > 0 && <br />}
              {segments.map((s, si) => s.type === 'link'
                ? <a key={si} href={s.href} style={LINK_STYLE} target={s.href.startsWith('mailto:') ? undefined : '_blank'} rel="noopener noreferrer">{s.text}</a>
                : <Fragment key={si}>{s.text}</Fragment>)}
            </Fragment>
          ))}
        </p>
      ))}
    </>
  );
}
