# OhMyMarkdown

Editeur Markdown moderne avec preview en temps reel, construit avec Tauri, React et TypeScript.

## Fonctionnalites

### Editeur split-view

- Vue editeur seul, preview seul ou split-view
- Synchronisation du scroll entre editeur et preview
- Sidebar depliable avec plan du document (navigation par titres)

### Mise en forme

| Action | Raccourci |
|--------|-----------|
| Gras | Ctrl+B |
| Italique | Ctrl+I |
| Souligne | Ctrl+U |
| Barre | Ctrl+D |
| Code inline | Ctrl+E |
| Lien | Ctrl+K |
| Commentaire | - |
| Image | - |
| Titres 1-6 | Menu Paragraphe |

### Edition

| Action | Raccourci |
|--------|-----------|
| Annuler | Ctrl+Z |
| Retablir | Ctrl+Y / Ctrl+Shift+Z |
| Couper | Ctrl+X |
| Copier | Ctrl+C |
| Coller | Ctrl+V |

### Fichiers

| Action | Raccourci |
|--------|-----------|
| Ouvrir | Ctrl+O |
| Enregistrer | Ctrl+S |
| Enregistrer sous | Ctrl+Shift+S |

### Import (via Pandoc + pdf-extract)

Word (.docx), PDF (.pdf), HTML, LaTeX, EPUB, reStructuredText, Org Mode, LibreOffice (.odt), CSV, Textile, MediaWiki

### Export (via Pandoc + impression native)

Word (.docx), PDF (.pdf), HTML, LaTeX, EPUB, reStructuredText, Org Mode, LibreOffice (.odt), Textile, MediaWiki

## Prerequis

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/)
- [Rust](https://rustup.rs/)
- [Pandoc](https://pandoc.org/installing.html) (pour l'import/export multi-format)

## Installation

```bash
pnpm install
```

## Developpement

```bash
pnpm tauri dev
```

## Build

```bash
pnpm tauri build
```

## Stack technique

- **Frontend** : React 19, TypeScript, Vite 7
- **Backend** : Rust, Tauri 2
- **Markdown** : marked
- **PDF** : pdf-extract (import), impression iframe (export)
- **Conversion** : Pandoc (import/export multi-format)
