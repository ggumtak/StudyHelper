# Study Helper – Developer Notes

- Source code, comments, and configuration stay in **English**. The **web UI copy only** should be written in Korean and kept in `src/web_app/index.html` plus `src/web_app/js/i18n.js`.
- Use UTF-8 for all files to avoid mojibake; do not mix encodings.
- Frontend: centralize Korean UI strings in `src/web_app/js/i18n.js` and avoid sprinkling text literals in new code. Keep UI logic modular (see `src/web_app/js/core/*`) and gradually retire legacy `app.js` by moving features into modules.
- Keep the app lightweight: prefer native browser APIs, avoid unnecessary dependencies, and guard network calls with retries/rate-limits like the existing helpers.
- When adding features, favor stability and clarity first (defensive checks, null guards, minimal globals) and update this note if rules change.
