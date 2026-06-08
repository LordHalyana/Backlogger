import { useEffect, useRef } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import type { Theme } from '../lib/theme.js';

interface DocumentEditorProps {
  /** The buffer text. When this value changes from outside, the editor is reset to it. */
  value: string;
  onChange: (next: string) => void;
  theme: Theme;
  readOnly?: boolean;
  /** A key that, when changed, forces the editor to fully reset (e.g. switching documents). */
  documentKey?: string;
  /** Wiki-link autocomplete suggestions (project titles). May change without rebuilding the editor. */
  wikiTitles?: readonly string[];
}

export function DocumentEditor({
  value,
  onChange,
  theme,
  readOnly = false,
  documentKey,
  wikiTitles,
}: DocumentEditorProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartmentRef = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const titlesRef = useRef<readonly string[]>(wikiTitles ?? []);
  /**
   * Tracks the most recent doc string the editor itself emitted via `onChange`.
   * The external `value` prop trails the editor by a render or two while React
   * propagates state. Without this ref, the `[value]` effect below would write
   * the stale `value` back into CodeMirror mid-typing and clobber freshly typed
   * characters.
   */
  const lastEmittedRef = useRef<string>(value);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    titlesRef.current = wikiTitles ?? [];
  }, [wikiTitles]);

  // Mount / rebuild the editor when `documentKey` (or readOnly) changes.
  useEffect(() => {
    if (!hostRef.current) return;
    lastEmittedRef.current = value;
    const themeExt = theme === 'dark' ? oneDark : [];
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown(),
        closeBrackets(),
        autocompletion({ override: [makeWikiLinkSource(titlesRef)] }),
        keymap.of([...closeBracketsKeymap, ...completionKeymap]),
        EditorView.lineWrapping,
        EditorState.readOnly.of(readOnly),
        themeCompartmentRef.current.of(themeExt),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const next = update.state.doc.toString();
            lastEmittedRef.current = next;
            onChangeRef.current(next);
          }
        }),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // Only recreate the CodeMirror EditorView when document identity or readOnly changes.
    // Extensions (theme, autocomplete) are updated in-place via compartments; rebuilding
    // on every change would destroy unsaved editor state and reset scroll position.
  }, [documentKey, readOnly]);

  // Swap the theme without rebuilding the editor.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: themeCompartmentRef.current.reconfigure(theme === 'dark' ? oneDark : []),
    });
  }, [theme]);

  // Apply external value changes (e.g. server-confirmed updated_at + body or a
  // programmatic reset) without clobbering in-flight typing. We skip the
  // dispatch when `value` matches what the editor itself last emitted — that
  // means the change originated from the editor and React is just catching up.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (value === lastEmittedRef.current) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    lastEmittedRef.current = value;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  }, [value]);

  return <div ref={hostRef} className="editor-host" />;
}

/**
 * Autocomplete source for `[[Title` patterns. Reads the latest titles list from a ref
 * so we can update suggestions without rebuilding the editor.
 */
function makeWikiLinkSource(
  titlesRef: React.MutableRefObject<readonly string[]>,
) {
  return (context: CompletionContext): CompletionResult | null => {
    // Match an open `[[` followed by everything up to the cursor that is not
    // a closing bracket, pipe, or newline.
    const match = context.matchBefore(/\[\[([^\]|\n]*)$/);
    if (!match) return null;
    if (match.from === match.to && !context.explicit) return null;
    const query = match.text.slice(2).toLowerCase();
    const titles = titlesRef.current;
    const options = titles
      .filter((t) => !query || t.toLowerCase().includes(query))
      .slice(0, 20)
      .map((t) => ({
        label: t,
        type: 'text',
        apply: `${t}]]`,
      }));
    if (options.length === 0) return null;
    return {
      from: match.from + 2,
      to: match.to,
      options,
      validFor: /^[^\]|\n]*$/,
    };
  };
}
