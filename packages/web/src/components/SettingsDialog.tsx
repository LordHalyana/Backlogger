import type { Theme } from '../lib/theme.js';
import { useReindex } from '../lib/reindex.js';
import { useReloadTemplates, useTemplates } from '../lib/templates.js';

interface SettingsDialogProps {
  theme: Theme;
  onToggleTheme: () => void;
  onClose: () => void;
  onOpenHelp?: () => void;
}

export function SettingsDialog({ theme, onToggleTheme, onClose, onOpenHelp }: SettingsDialogProps): JSX.Element {
  const reindex = useReindex();
  const reloadTemplates = useReloadTemplates();
  const templates = useTemplates();

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          <h2>Settings</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <section className="settings-section">
          <h3>Appearance</h3>
          <div className="settings-row">
            <span>Theme</span>
            <button type="button" className="theme-toggle" onClick={onToggleTheme}>
              {theme === 'dark' ? '☀ Light' : '☾ Dark'}
            </button>
          </div>
        </section>

        <section className="settings-section">
          <h3>Data</h3>
          <div className="settings-row">
            <span>Rebuild document index from disk</span>
            <button
              type="button"
              onClick={() => reindex.run()}
              disabled={reindex.isPending}
            >
              {reindex.isPending ? 'Reindexing…' : 'Reindex'}
            </button>
          </div>
        </section>

        <section className="settings-section">
          <h3>Templates</h3>
          <div className="settings-row">
            <span>Reload templates from disk</span>
            <button
              type="button"
              onClick={() => reloadTemplates.run()}
              disabled={reloadTemplates.isPending}
            >
              {reloadTemplates.isPending ? 'Reloading…' : 'Reload'}
            </button>
          </div>
          {templates.data && templates.data.length > 0 && (
            <table className="settings-template-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {templates.data.map((t) => (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td>{t.type}</td>
                    <td>
                      <span className={`template-source-badge ${t.source ?? 'builtin'}`}>
                        {t.source === 'user' ? 'user' : 'built-in'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {onOpenHelp && (
          <section className="settings-section">
            <h3>Help</h3>
            <div className="settings-row">
              <span>Learn Backlogger: Markdown, wiki-links, tags, search, templates, projects, import/export.</span>
              <button type="button" onClick={onOpenHelp}>
                Open Help
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
