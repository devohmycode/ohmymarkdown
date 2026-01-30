# AGENTS.md - OhMyMarkdown

## Commands
- **Dev**: `pnpm tauri dev` - Run the app in development mode
- **Build**: `pnpm build` (frontend) or `pnpm tauri build` (full app)
- **Typecheck**: `pnpm exec tsc --noEmit`
- **Rust check**: `cargo check` (run from src-tauri/)

## Architecture
- **Frontend**: React 19 + TypeScript + Vite in `src/`
- **Backend**: Tauri 2 + Rust in `src-tauri/`
- **Main component**: `src/components/MarkdownEditor.tsx` - split-view markdown editor
- **Tauri commands**: Defined in `src-tauri/src/lib.rs` (e.g., `convert_word_to_markdown`)
- **Tauri plugins**: dialog, fs, opener for native file operations

## Code Style
- TypeScript with strict mode; no unused locals/parameters
- React functional components with hooks (useState, useMemo, useCallback, useRef)
- Use `@tauri-apps/plugin-*` for native APIs (dialog, fs)
- Use `invoke` from `@tauri-apps/api/core` to call Rust commands
- CSS files co-located with components (e.g., `MarkdownEditor.css`)
- French UI strings (this is a French-language app)
