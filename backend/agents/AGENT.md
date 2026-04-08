# AEM Trainer Agent — Training Pipeline

## Purpose

This pipeline defines how the AEM Trainer Platform agents work together to teach AEM concepts, generate example code, build & deploy it, create test pages for trainees, and validate the output.

The platform has **three agent roles**:

| Agent | File | Route | Purpose |
|-------|------|-------|---------|
| Trainer | `trainerAgent.js` | `POST /train` | Teaches lessons OR generates component code |
| Reviewer | `reviewerAgent.js` | `POST /ask` | Repo-aware code review and Q&A |
| Executor | `executorAgent.js` | `POST /execute` | Runs shell commands (mvn, curl, etc.) |

---

## Project Configuration

All project-specific values come from `config/project-config.json`, managed by `services/projectConfigService.js`. The trainee configures these via the **Setup Panel** in the frontend (`POST /setup/config`).

### Key Values

| Value | Source | Example |
|-------|--------|---------|
| `appId` | `projectConfig.appId` | `mysite` |
| `appTitle` | `projectConfig.appTitle` | `My Site` |
| `groupId` | `projectConfig.groupId` | `com.mycompany` |
| `aemVersion` | `projectConfig.aemVersion` | `6.5.8` |
| `componentsPath` | `getComponentsPath()` | `ui.apps/src/main/content/jcr_root/apps/mysite/components` |
| `modelsPath` | `getModelsPath()` | `core/src/main/java/com/mycompany/core/models` |
| `servletsPath` | `getServletsPath()` | `core/src/main/java/com/mycompany/core/servlets` |
| `servicesPath` | `getServicesPath()` | `core/src/main/java/com/mycompany/core/services` |
| `filtersPath` | `getFiltersPath()` | `core/src/main/java/com/mycompany/core/filters` |
| `javaPackage` | `getJavaPackage()` | `com.mycompany.core` |
| `componentGroup` | `getComponentGroup()` | `My Site - Content` |

The AEM project directory is resolved as: `AEM_PROJECTS_DIR / appId` (e.g., `/Users/pradeep/Documents/GitHub/mysite`).

---

## AI Modes

The platform supports two AI modes (set via `AI_MODE` in `.env`):

- **mock** (default): Returns structured template responses — useful for demos and development without an AI backend.
- **claude**: Calls Claude CLI (`claude -p "<prompt>"`) for real AI-generated lessons and code.

---

## Training Pipeline (7 Steps)

### Step 0 — Verify Project Setup

Before generating any code:
1. Check that the project is configured (`projectConfigService.isConfigured()`)
2. If not configured, prompt the trainee to complete the Setup Panel first
3. Verify the AEM project directory exists on disk at `AEM_PROJECTS_DIR / appId`

---

### Step 1 — Detect Request Type

The Trainer Agent receives the trainee's message and determines the mode:

**Teaching Mode** — when the message is a question or learning request:
- Generate a structured lesson with: explanation, step-by-step guidance, hands-on lab, review checklist
- Focus on the selected topic (from the topic dropdown: Sling Models, Servlets, OSGi Services, HTL, etc.)

**Build Mode** — when the message contains build keywords (`create`, `build`, `scaffold`, `generate`, `make`, `add component`, `new component`):
- Proceed to Step 2 (code generation pipeline)

---

### Step 2 — Plan the Component

For build requests, identify all artifacts needed:

| Artifact | Path Pattern |
|----------|-------------|
| Component definition | `ui.apps/src/main/content/jcr_root/apps/{appId}/components/{name}/.content.xml` |
| HTL template | `ui.apps/src/main/content/jcr_root/apps/{appId}/components/{name}/{name}.html` |
| Authoring dialog | `ui.apps/src/main/content/jcr_root/apps/{appId}/components/{name}/_cq_dialog/.content.xml` |
| Sling Model | `core/src/main/java/{groupPath}/core/models/{Name}Model.java` |
| Clientlibs (if needed) | `ui.apps/src/main/content/jcr_root/apps/{appId}/clientlibs/clientlib-{name}/` |

Infer reasonable defaults from the trainee's request. Only ask for clarification if truly blocked.

---

### Step 3 — Generate Code

Use `aiService.askAIForComponentFiles()` to generate files. The AI (or mock) returns:

```json
{
  "explanation": "Markdown explanation of what was created",
  "files": [
    { "path": "relative/path", "content": "file content" }
  ]
}
```

Code generation rules:
- **Component `.content.xml`**: Use `componentGroup` from project config
- **Sling Models**: `@Model(adaptables = Resource.class)` with `DefaultInjectionStrategy.OPTIONAL`
- **Dialogs**: Coral UI 3 with `granite/ui/components/coral/foundation/` resource types
- **HTL**: Use `data-sly-use`, `data-sly-test`, `data-sly-list`
- **Package names**: Use `{groupId}.core.models`, `{groupId}.core.servlets`, etc.

---

### Step 4 — Write Files

Use `fileWriterService.writeFiles()` to safely create all generated files:
- Validates file paths (must be within the AEM project directory)
- Validates file extensions (allowed: `.xml`, `.html`, `.java`, `.js`, `.ts`, `.scss`, `.css`, `.json`, `.txt`, `.cfg`, `.config`)
- Tracks each creation as a **task** with a unique `taskId` for revert capability
- Returns created and failed file lists

---

### Step 5 — Build & Deploy

Run Maven commands via the Executor Agent (`POST /execute`):

1. **Build only** (verify compilation):
   ```
   mvn clean install
   ```

2. **Build + Deploy to local AEM**:
   ```
   mvn clean install -PautoInstallPackage
   ```

3. **Deploy core bundle only** (faster, for Java-only changes):
   ```
   mvn clean install -pl core -PautoInstallBundle
   ```

Validate:
- Build returns `BUILD SUCCESS`
- No compilation errors
- If deploying: package installed successfully

On failure: read the error output, fix the code, and rebuild.

---

### Step 6 — Create Test Page

Create a test page so the trainee can see the component in action on the AEM author instance.

**File-based approach** — create a `.content.xml` under `ui.content`:

```
ui.content/src/main/content/jcr_root/content/{appId}/us/en/trainer-test-{component-name}/
```

The test page should include:
- At least 2 component instances: one fully populated (happy path), one empty (edge case)
- Correct page template and container structure matching the project's existing pages

**Test page URL:**
```
http://localhost:4502/editor.html/content/{appId}/us/en/trainer-test-{component-name}.html
```

Deploy the test page:
```
mvn clean install -pl ui.content -PautoInstallPackage
```

---

### Step 7 — Report to Trainee

Return the results to the trainee with:

```
## Training Result

### What Was Created
- Component: {name} at {path}
- Sling Model: {Name}Model.java
- Dialog: {fields list}

### Files Created
| File | Status |
|------|--------|
| path/to/file | Created / Failed |

### Next Steps for the Trainee
1. Deploy with `mvn clean install -PautoInstallPackage`
2. Open AEM Author and navigate to the test page
3. Open the component dialog and configure it
4. Inspect the HTL, Sling Model, and dialog to understand how they connect

### Test Page
- URL: http://localhost:4502/editor.html/content/{appId}/us/en/trainer-test-{name}.html

### Revert
Use the "Revert" button in the Explorer panel to undo file creation if needed.
```

---

## Training Topics

The platform supports these focus topics (selectable in the chat dropdown):

1. General AEM
2. Sling Models
3. Servlets
4. OSGi Services
5. HTL
6. Content Fragments
7. Dispatcher
8. Workflows
9. JCR Queries
10. MSM and Launches

---

## Explorer Integration

The Explorer Panel (`GET /explorer/tree`) displays trainee-created files organized by category:

| Category | What It Shows |
|----------|--------------|
| Components | HTL, dialogs, component definitions |
| Sling Models | Java model classes |
| Servlets | Servlet classes |
| Services | OSGi service classes |
| Filters | Servlet filter classes |
| Frontend | JS, CSS, SCSS clientlib files |

Trainees can:
- Browse the file tree to see generated code
- Click a file to preview its content
- Click "Explain This File" for an AI-powered explanation
- Revert any task to delete generated files

---

## Guardrails

- Do NOT modify existing project files that were not created by this platform
- Do NOT delete unrelated files
- Do NOT run commands outside the allowed list (`mvn`, `curl`, `tail`, `ls`)
- Do NOT fake build or deployment results
- Always use project config values — never hardcode paths or package names
- Track all file creation as tasks so trainees can revert
- Validate file paths and extensions before writing
