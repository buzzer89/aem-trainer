# AEM AI Trainer Platform

## Folder Structure

```text
aem-trainer/
├── backend/
│   ├── agents/
│   ├── routes/
│   ├── services/
│   ├── package.json
│   └── server.js
├── config/
│   ├── default.js
│   └── topics.js
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── styles.css
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── scripts/
│   └── reindex.js
├── .env.example
└── package.json
```

## Setup

1. Copy `.env.example` to `.env` and update the AEM paths.
2. Install backend and frontend dependencies:

```bash
npm run install:all
```

3. Start the backend:

```bash
npm run dev:backend
```

4. Start the frontend in a second terminal:

```bash
npm run dev:frontend
```

5. Optional: rebuild the repo index on demand:

```bash
node scripts/reindex.js
```

## API Endpoints

- `POST /train`
- `POST /ask`
- `POST /execute`

## Notes

- `AI_MODE=mock` keeps the prototype self-contained.
- Set `AI_MODE=claude` to use the local `claude` CLI prompt flow.
- Repo indexing is driven by `AEM_PROJECT_DIR` and stores a snapshot at `config/repo-index.json`.
