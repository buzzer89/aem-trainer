// OpenAI support (v4 SDK)
let openaiApi = null;
if (process.env.OPENAI_API_KEY) {
  const { OpenAI } = require("openai");
  openaiApi = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function truncateText(value, max = 6000) {
  if (!value) return "";
  const asString = String(value);
  return asString.length <= max ? asString : `${asString.slice(0, max)}\n...[truncated]`;
}

function toDataBlock(label, value, max = 6000) {
  return [
    `<${label}>`,
    truncateText(value, max),
    `</${label}>`
  ].join("\n");
}

function normalizePrompt(prompt) {
  if (typeof prompt === "string") {
    return {
      system: "",
      user: prompt,
      text: prompt,
      openAIMessages: [{ role: "user", content: prompt }]
    };
  }

  const system = prompt?.system ? String(prompt.system) : "";
  const user = prompt?.user ? String(prompt.user) : "";
  const text = system
    ? `System Instructions:\n${system}\n\nUser Input:\n${user}`
    : user;
  const openAIMessages = [];

  if (system) {
    openAIMessages.push({ role: "system", content: system });
  }
  openAIMessages.push({ role: "user", content: user });

  return { system, user, text, openAIMessages };
}

function extractUserRequest(prompt) {
  const promptText = normalizePrompt(prompt).text;
  const userRequestMatch = promptText.match(/User request:\s*(.+)/i);
  return userRequestMatch ? userRequestMatch[1].trim() : "";
}

async function askWithOpenAI(prompt) {
  if (!openaiApi) throw new Error("OpenAI API key not set");
  const model = process.env.OPENAI_MODEL || "gpt-4";
  const normalized = normalizePrompt(prompt);
  const res = await openaiApi.chat.completions.create({
    model,
    messages: normalized.openAIMessages,
    temperature: 0.2
  });
  return res.choices[0].message.content.trim();
}
const fs = require("fs");
const path = require("path");

const appConfig = require("../../config/default");
const topics = require("../../config/topics");
const projectConfigService = require("./projectConfigService");
const logger = require("./logger");

/**
 * Extract the first balanced JSON object from a string.
 * Handles markdown fences, trailing text, and nested braces.
 */
function extractJSON(raw) {
  const stripped = raw.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "");
  const start = stripped.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"' && !escape) { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(stripped.slice(start, i + 1));
        } catch (e) {
          return null;
        }
      }
    }
  }
  return null;
}

const AGENTS_DIR = path.join(__dirname, "..", "agents");

const agentContextCache = {};

function getPromptProjectContext() {
  const config = projectConfigService.get();
  return [
    "Project context (set before generation):",
    `- AEM version: ${process.env.AEM_VERSION || "{{AEM_VERSION}}"}`,
    `- Core Components version: ${process.env.CORE_COMPONENTS_VERSION || "{{CORE_COMPONENTS_VERSION}}"}`,
    `- Java / JDK: ${process.env.JAVA_VERSION || "{{JAVA_VERSION}}"}`,
    `- Maven coordinates: groupId=${config.groupId || "{{GROUP_ID}}"}, artifactId=${config.artifactId || "{{ARTIFACT_ID}}"}`,
    `- Run modes: ${process.env.AEM_RUNMODES || "{{runmodes}}"}`,
    `- Component repo path: /apps/${config.appId || "{{projectName}}"}/components`,
    `- Content base path: /content/${config.appId || "{{website}}"}/...`
  ].join("\n");
}

function getAemPromptPreamble(taskLine) {
  return [
    "You are an expert AEM developer and code generator.",
    taskLine,
    "If any required detail is missing, ask one clarifying question before generating code.",
    "",
    getPromptProjectContext(),
    "",
    "General rules & constraints:",
    "- Do not use deprecated AEM/Sling APIs for the target version.",
    "- Keep business logic in Java/OSGi services; HTL is presentation-only.",
    "- Use Sling Models and OSGi Declarative Services annotations.",
    "- Never use admin sessions; use service user mappings for system access.",
    "- Do not hardcode secrets or credentials.",
    "- Follow secure coding, accessibility, and performance best practices."
  ].join("\n");
}

function loadAgentContext(filename) {
  if (agentContextCache[filename]) {
    return agentContextCache[filename];
  }

  try {
    const filePath = path.join(AGENTS_DIR, filename);
    const content = fs.readFileSync(filePath, "utf8");
    agentContextCache[filename] = content;
    return content;
  } catch (error) {
    logger.warn("Failed to load agent context file", { filename, error: error.message });
    return "";
  }
}

function getTrainerContext() {
  const pipeline = loadAgentContext("AGENT.md");
  const feature = loadAgentContext("aem-feature.agent.md");
  return [pipeline, feature].filter(Boolean).join("\n\n---\n\n");
}

function getQAContext() {
  return loadAgentContext("aem-qa.agent.md");
}

function createMockResponse(prompt, options = {}) {
  const { mode, fallbackContext = {} } = options;
  const topic = fallbackContext.topic || "General AEM";
  const question = fallbackContext.message || "No question supplied.";
  const promptText = normalizePrompt(prompt).text;

  if (mode === "trainer") {
    return [
      `## ${topic} Training Guide`,
      "",
      `You asked: ${question}`,
      "",
      "### Explanation",
      `This prototype is in mock mode, so the Trainer Agent is returning a structured lesson for ${topic}. In a real deployment, replace this layer with Claude CLI or your preferred LLM API.`,
      "",
      "### Steps",
      "1. Understand the AEM concept and where it lives in the codebase.",
      "2. Map the topic to OSGi bundles, Sling resources, or content structures.",
      "3. Test the implementation path locally in author or publish.",
      "",
      "### Lab",
      "```bash",
      "Create a small feature branch, identify one related component, and trace request -> model -> HTL -> dialog.",
      "```",
      "",
      "### Review Checklist",
      "- Confirm naming conventions and package structure.",
      "- Validate resource types, adapters, and exports.",
      "- Verify authoring behavior and deployment packaging."
    ].join("\n");
  }

  if (mode === "reviewer") {
    const searchResults = fallbackContext.searchResults || [];
    const referenceLines = searchResults.length
      ? searchResults
          .map((result) => `- ${result.path} (score: ${result.score})`)
          .join("\n")
      : "- No matching files were found in the current repo index.";

    return [
      `## Reviewer Notes`,
      "",
      `Question: ${question}`,
      "",
      "This prototype is in mock mode, so the Reviewer Agent is summarizing repo-aware hints from the local index.",
      "",
      "### Likely Relevant Files",
      referenceLines,
      "",
      "### Guidance",
      "Cross-check the referenced files for service registration, Sling annotations, resource types, and package structure.",
      "If the index did not return strong matches, reindex the repo after pointing `AEM_PROJECT_DIR` at the real AEM codebase."
    ].join("\n");
  }

  if (mode === "explain") {
    const filePath = fallbackContext.filePath || "unknown file";
    const fileContent = fallbackContext.content || "";
    const ext = filePath.split(".").pop();

    const typeMap = {
      java: "Java class (likely a Sling Model, Servlet, or OSGi Service)",
      html: "HTL (Sightly) template for rendering component markup",
      xml: "JCR content definition (component metadata, dialog, or node structure)",
      js: "JavaScript module (client-side behavior or build config)",
      ts: "TypeScript module",
      scss: "SCSS stylesheet for component styling",
      css: "CSS stylesheet"
    };

    const fileType = typeMap[ext] || "project file";

    return [
      `## File Explanation: \`${filePath}\``,
      "",
      `**Type:** ${fileType}`,
      "",
      "### Purpose",
      `This file is part of the AEM project. In mock mode, the AI cannot analyze the actual content. Switch to \`AI_MODE=claude\` for a detailed walkthrough.`,
      "",
      "### Preview",
      "```",
      fileContent.slice(0, 800),
      "```",
      "",
      "### Key Concepts",
      "- Check the file extension and location to understand its role",
      "- `.html` files in components/ are HTL templates",
      "- `.java` files in models/ are Sling Models",
      "- `_cq_dialog/.content.xml` defines the authoring dialog",
      "- `.content.xml` at component root defines component metadata"
    ].join("\n");
  }

  return [
    "## AI Service",
    "",
    "The AI layer is running in mock mode.",
    "",
    "### Supported Topics",
    topics.map((topicName) => `- ${topicName}`).join("\n"),
    "",
    "### Prompt Preview",
    "```text",
    promptText.slice(0, 1200),
    "```"
  ].join("\n");
}

async function askWithClaude(prompt) {
  const normalizedPrompt = normalizePrompt(prompt);
  const os = require("os");

  const child = require("child_process").spawn(
    appConfig.ai.claudeCommand,
    ["-p", "--model", "sonnet"],
    {
      cwd: os.tmpdir(),      // neutral directory — avoids stale conversation context
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env }
    }
  );

  // Write prompt to stdin and close
  child.stdin.write(normalizedPrompt.text);
  child.stdin.end();

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (stderr) {
        logger.warn("Claude CLI wrote to stderr", { stderr: stderr.trim() });
      }
      if (code !== 0) {
        return reject(new Error(`Claude CLI exited with code ${code}: ${stderr.trim()}`));
      }
      resolve(stdout.trim());
    });
  });
}

async function askAI(prompt, options = {}) {
  if (appConfig.ai.mode === "claude") {
    try {
      return await askWithClaude(prompt);
    } catch (error) {
      logger.warn("Claude CLI failed, falling back to mock mode", {
        error: error.message
      });
    }
  } else if (appConfig.ai.mode === "openai") {
    try {
      return await askWithOpenAI(prompt);
    } catch (error) {
      logger.warn("OpenAI API failed, falling back to mock mode", {
        error: error.message
      });
    }
  }
  return createMockResponse(prompt, options);
}

function sanitizeComponentName(rawName) {
  const stopWords = new Set([
    "create", "build", "scaffold", "generate", "make", "add", "new",
    "update", "modify", "enhance", "refactor", "fix", "edit", "extend",
    "component", "components", "with", "below", "above", "following", "features",
    "and", "the", "a", "an", "for", "that", "has", "have", "having", "including",
    "please", "i", "want", "need", "like", "would", "should", "could", "can",
    "which", "who", "whose", "whom", "where", "when", "why", "how",
    "queries", "gets", "displays", "shows", "renders", "fetches", "retrieves",
    "all", "each", "every", "some", "any", "this", "these", "those",
    "under", "over", "from", "into", "onto", "upon", "about", "between",
    "page", "pages", "path", "result", "results", "data", "content",
    "on", "in", "at", "to", "of", "by", "is", "are", "it", "its", "be",
    "authored", "configured", "displayed", "created", "built", "added"
  ]);

  // Strip everything after a clause boundary
  const corePart = rawName
    .split(/\s*[-:—]\s*|\s+(?:which|that|who|where|when|such as|like|including|having)\s+/i)[0];

  // Extract meaningful words (keep first 2 for naming)
  const words = corePart
    .replace(/[^a-zA-Z\s]/g, "")
    .split(/\s+/)
    .filter((w) => w && !stopWords.has(w.toLowerCase()))
    .slice(0, 2);

  if (words.length === 0) {
    return { folderName: "customcomponent", className: "CustomComponent", jcrTitle: "Custom Component" };
  }

  const folderName = words.join("").toLowerCase().slice(0, 20);
  const className = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("");
  const jcrTitle = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");

  return {
    folderName: folderName || "customcomponent",
    className: className || "CustomComponent",
    jcrTitle: jcrTitle || "Custom Component"
  };
}

/**
 * Detect what type of AEM artifact the user is requesting.
 * Returns: "component", "servlet", "service", "scheduler", "filter", "workflow", "listener"
 */
function detectArtifactType(message) {
  const lower = message.toLowerCase();
  // Order matters: check compound terms first (servlet filter → filter, not servlet)
  if (/\bservlet\s*filter\b|\brequest\s*filter\b/.test(lower)) return "filter";
  if (/\bfilter\b/.test(lower)) return "filter";
  if (/\bscheduler\b|\bcron\b|\bscheduled\s+task\b/.test(lower)) return "scheduler";
  if (/\bworkflow\b|\bworkflow\s*step\b|\bworkflow\s*process\b/.test(lower)) return "workflow";
  if (/\bevent\s*listener\b|\bevent\s*handler\b|\bobservation\s*listener\b/.test(lower)) return "listener";
  if (/\bservlet\b/.test(lower)) return "servlet";
  if (/\bosgi\s*service\b|\bservice\s+class\b|\bservice\s+to\b|\bservice\s+for\b|\bservice\s+that\b/.test(lower)) return "service";
  if (/\bsling\s*model\b/.test(lower)) return "model";
  return "component";
}

/**
 * Derive a clean class name from the user request based on artifact type.
 * For "Create a servlet to generate sitemap.xml" → { className: "SitemapXml", type: "servlet" }
 */
function inferBuildIntent(message) {
  const input = String(message || "");
  const lower = input.toLowerCase();
  const isUpdate = /(update|modify|enhance|refactor|fix|edit|extend)\b/.test(lower);
  const isCreate = /(create|build|scaffold|generate|make|add|new)\b/.test(lower);
  const mode = isUpdate && !isCreate ? "update" : "create";
  const artifactType = detectArtifactType(input);

  if (artifactType === "component") {
    // "component named foo" or "component called foo"
    const namedExplicit = input.match(/component\s+(?:named|called)\s+([a-zA-Z][a-zA-Z0-9 -_]+)/i);
    // "foo bar component" (up to 3 words before "component")
    const trailingMatch = input.match(/\b((?:[a-zA-Z]+\s+){0,2}[a-zA-Z]+)\s+component\b/i);
    const explicitName = (namedExplicit?.[1] || trailingMatch?.[1] || input).trim();
    const naming = sanitizeComponentName(explicitName);
    return { mode, artifactType, ...naming };
  }

  // For non-component artifacts, derive class name differently
  const artifactWord = artifactType; // "servlet", "service", etc.
  const suffix = artifactType.charAt(0).toUpperCase() + artifactType.slice(1); // "Servlet", "Service"

  // Remove the artifact type word and stop words to get the core concept
  const conceptWords = input
    .replace(/[^a-zA-Z\s]/g, "")
    .split(/\s+/)
    .filter((w) => {
      const lw = w.toLowerCase();
      return w && !["create", "build", "scaffold", "generate", "make", "add", "new",
        "update", "modify", "enhance", "refactor", "fix", "a", "an", "the", "for",
        "to", "that", "which", "this", "and", "or", "with", "from", "of", "in",
        artifactWord, "osgi", "sling", "aem", "class"
      ].includes(lw);
    })
    .slice(0, 3)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

  const baseName = conceptWords.length > 0 ? conceptWords.join("") : "Custom";
  const className = baseName + suffix;
  const folderName = baseName.toLowerCase();

  return { mode, artifactType, folderName, className, jcrTitle: conceptWords.join(" ") || "Custom" };
}

function createMockBuilderResponse(name, artifactType) {
  const config = projectConfigService.get();
  const javaPackage = projectConfigService.getJavaPackage();

  if (artifactType && artifactType !== "component") {
    // Non-component mock: generate a simple Java file
    const pathMap = {
      servlet: projectConfigService.getServletsPath(),
      service: projectConfigService.getServicesPath(),
      scheduler: projectConfigService.getServicesPath(),
      filter: projectConfigService.getFiltersPath()
    };
    const subPackage = artifactType === "filter" ? "filters" : (artifactType === "servlet" ? "servlets" : "services");
    const javaPath = (pathMap[artifactType] || projectConfigService.getServicesPath()) + `/${name}.java`;

    return {
      explanation: [
        `## ${artifactType.charAt(0).toUpperCase() + artifactType.slice(1)}: ${name}`,
        "",
        "### What was created",
        `- **${artifactType}** at \`${javaPath}\``,
        "",
        "### Next Steps",
        "1. Deploy with `mvn clean install -PautoInstallBundle -pl core`",
        "2. Verify the bundle is active in the Felix console",
        `3. Test the ${artifactType} endpoint or behavior`
      ].join("\n"),
      files: [
        {
          path: javaPath,
          content: [
            `package ${javaPackage}.${subPackage};`,
            "",
            `// Mock ${artifactType} — switch AI_MODE to claude for real code generation`,
            `public class ${name} {`,
            "    // TODO: implement",
            "}"
          ].join("\n")
        }
      ]
    };
  }

  // Component mock (existing behavior)
  const { folderName: lowerName, className: titleName } = sanitizeComponentName(name);
  const basePath = `${projectConfigService.getComponentsPath()}/${lowerName}`;
  const modelPath = `${projectConfigService.getModelsPath()}/${titleName}Model.java`;
  const componentGroup = projectConfigService.getComponentGroup();

  return {
    explanation: [
      `## Component: ${name}`,
      "",
      "### What was created",
      `- **Component definition** with dialog at \`${basePath}/\``,
      `- **HTL template** for rendering at \`${basePath}/${lowerName}.html\``,
      `- **Sling Model** at \`${modelPath}\``,
      "",
      "### Next Steps",
      "1. Deploy with `mvn clean install -PautoInstallPackage`",
      "2. Open a page in AEM Author and add the component from the side panel",
      "3. Configure the component via its dialog",
      "4. Customize the HTL and Sling Model for your needs"
    ].join("\n"),
    files: [
      {
        path: `${basePath}/.content.xml`,
        content: [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<jcr:root xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0"',
          '    jcr:primaryType="cq:Component"',
          `    jcr:title="${titleName}"`,
          `    componentGroup="${componentGroup}"/>`
        ].join("\n")
      },
      {
        path: `${basePath}/${lowerName}.html`,
        content: [
          `<sly data-sly-use.model="${javaPackage}.models.${titleName}Model"/>`,
          `<div class="cmp-${lowerName}"`,
          `     data-cmp-is="${lowerName}">`,
          `    <h2 class="cmp-${lowerName}__title"`,
          `        data-sly-test="\${model.title}">`,
          `        \${model.title}</h2>`,
          `    <div class="cmp-${lowerName}__description"`,
          `         data-sly-test="\${model.description}">`,
          `        \${model.description}</div>`,
          "</div>"
        ].join("\n")
      },
      {
        path: `${basePath}/_cq_dialog/.content.xml`,
        content: [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0"',
          '    xmlns:cq="http://www.day.com/jcr/cq/1.0"',
          '    xmlns:jcr="http://www.jcp.org/jcr/1.0"',
          '    xmlns:nt="http://www.jcp.org/jcr/nt/1.0"',
          '    jcr:primaryType="nt:unstructured"',
          '    jcr:title="Properties"',
          '    sling:resourceType="cq/gui/components/authoring/dialog">',
          '    <content',
          '        jcr:primaryType="nt:unstructured"',
          '        sling:resourceType="granite/ui/components/coral/foundation/fixedcolumns">',
          '        <items jcr:primaryType="nt:unstructured">',
          '            <column',
          '                jcr:primaryType="nt:unstructured"',
          '                sling:resourceType="granite/ui/components/coral/foundation/container">',
          '                <items jcr:primaryType="nt:unstructured">',
          '                    <title',
          '                        jcr:primaryType="nt:unstructured"',
          '                        sling:resourceType="granite/ui/components/coral/foundation/form/textfield"',
          '                        fieldLabel="Title"',
          '                        name="./title"/>',
          '                    <description',
          '                        jcr:primaryType="nt:unstructured"',
          '                        sling:resourceType="granite/ui/components/coral/foundation/form/textarea"',
          '                        fieldLabel="Description"',
          '                        name="./description"/>',
          '                </items>',
          '            </column>',
          '        </items>',
          '    </content>',
          '</jcr:root>'
        ].join("\n")
      },
      {
        path: modelPath,
        content: [
          `package ${javaPackage}.models;`,
          "",
          "import org.apache.sling.api.resource.Resource;",
          "import org.apache.sling.models.annotations.DefaultInjectionStrategy;",
          "import org.apache.sling.models.annotations.Model;",
          "import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;",
          "",
          `@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)`,
          `public class ${titleName}Model {`,
          "",
          '    @ValueMapValue',
          "    private String title;",
          "",
          '    @ValueMapValue',
          "    private String description;",
          "",
          "    public String getTitle() {",
          "        return title;",
          "    }",
          "",
          "    public String getDescription() {",
          "        return description;",
          "    }",
          "}"
        ].join("\n")
      }
    ]
  };
}

function buildFeaturePrompt({ message, topic, repoContext }) {
  const config = projectConfigService.get();
  const javaPackage = projectConfigService.getJavaPackage();
  const intent = inferBuildIntent(message);
  const { mode, artifactType, folderName, className, jcrTitle } = intent;

  // --- Project details block (shared across all artifact types) ---
  const projectBlock = [
    "Project details:",
    `- Group ID: ${config.groupId}`,
    `- App ID: ${config.appId}`,
    `- Java package: ${javaPackage}`,
    `- Components path: ${projectConfigService.getComponentsPath()}/`,
    `- Sling Models path: ${projectConfigService.getModelsPath()}/`,
    `- Servlets path: ${projectConfigService.getServletsPath()}/`,
    `- Services path: ${projectConfigService.getServicesPath()}/`,
    `- Filters path: ${projectConfigService.getFiltersPath()}/`,
    `- Component group: ${projectConfigService.getComponentGroup()}`
  ].join("\n");

  // --- Artifact-specific instructions ---
  let artifactInstructions;

  if (artifactType === "component") {
    const componentsPath = projectConfigService.getComponentsPath();
    const modelsPath = projectConfigService.getModelsPath();
    artifactInstructions = [
      `You are creating an AEM COMPONENT. Artifact type: component.`,
      "",
      "=== USE THESE EXACT NAMES ===",
      `Component folder: ${folderName}`,
      `Java class: ${className}Model`,
      `jcr:title: ${jcrTitle}`,
      "",
      "Required files:",
      `  - ${componentsPath}/${folderName}/.content.xml (component definition)`,
      `  - ${componentsPath}/${folderName}/${folderName}.html (HTL template)`,
      `  - ${componentsPath}/${folderName}/_cq_dialog/.content.xml (authoring dialog)`,
      `  - ${modelsPath}/${className}Model.java (Sling Model)`,
      `  - ui.content/src/main/content/jcr_root/content/${config.appId}/us/en/trainer-test-${folderName}/.content.xml (test page)`,
      "",
      "AEM Component Conventions:",
      `- .content.xml: jcr:primaryType='cq:Component', jcr:title='${jcrTitle}', componentGroup='${projectConfigService.getComponentGroup()}'`,
      `- HTL: <sly data-sly-use.model='${javaPackage}.models.${className}Model'/>, use data-sly-test for null checks`,
      "- Dialog: sling:resourceType='cq/gui/components/authoring/dialog', field names start with './' and MUST match Sling Model @ValueMapValue field names (case-sensitive)",
      `- Sling Model: package ${javaPackage}.models; @Model(adaptables=Resource.class, defaultInjectionStrategy=DefaultInjectionStrategy.OPTIONAL)`,
      `- Java class: public class ${className}Model { ... }`,
      "- If the component needs client-side logic or styles, also generate a clientlibs folder"
    ].join("\n");
  } else if (artifactType === "servlet") {
    const servletsPath = projectConfigService.getServletsPath();
    artifactInstructions = [
      `You are creating an AEM SERVLET. Artifact type: servlet.`,
      `DO NOT create any component files (.content.xml, HTL, dialog). Only create Java files.`,
      "",
      "=== USE THESE EXACT NAMES ===",
      `Java class: ${className}`,
      `File path: ${servletsPath}/${className}.java`,
      "",
      "Required files (ONLY these — no components, no HTL, no dialog):",
      `  - ${servletsPath}/${className}.java`,
      `  - If the servlet needs a helper service, also create: ${projectConfigService.getServicesPath()}/<ServiceName>.java`,
      "",
      "AEM Servlet Conventions:",
      `- Package: ${javaPackage}.servlets`,
      "- Use @SlingServletResourceTypes or @SlingServletPaths annotation (prefer resource types for security)",
      "- Extend SlingSafeMethodsServlet (GET) or SlingAllMethodsServlet (GET+POST)",
      "- Implement doGet() and/or doPost() methods",
      "- Use @Reference or @OSGiService to inject services",
      "- Set proper response content type (application/json, text/xml, text/html)",
      "- Handle exceptions properly with appropriate HTTP status codes",
      "- Use ResourceResolverFactory with service users, never admin sessions",
      "- Add @Component annotation with service = Servlet.class",
      "- Add proper SCR/OSGi metadata",
      "",
      "If the servlet requires a separate service layer (business logic), generate both:",
      `  1. The servlet in ${javaPackage}.servlets`,
      `  2. The service interface + impl in ${javaPackage}.services`
    ].join("\n");
  } else if (artifactType === "service") {
    const servicesPath = projectConfigService.getServicesPath();
    artifactInstructions = [
      `You are creating an AEM OSGI SERVICE. Artifact type: service.`,
      `DO NOT create any component files (.content.xml, HTL, dialog). Only create Java files.`,
      "",
      "=== USE THESE EXACT NAMES ===",
      `Java class: ${className}`,
      `Interface: ${servicesPath}/${className}.java`,
      `Implementation: ${servicesPath}/impl/${className}Impl.java`,
      "",
      "Required files (ONLY these — no components):",
      `  - ${servicesPath}/${className}.java (interface)`,
      `  - ${servicesPath}/impl/${className}Impl.java (implementation)`,
      "",
      "AEM OSGi Service Conventions:",
      `- Interface package: ${javaPackage}.services`,
      `- Impl package: ${javaPackage}.services.impl`,
      "- Use @Component(service = <InterfaceName>.class) on the implementation",
      "- Use @Designate(ocd = ...) for configurable services with @ObjectClassDefinition",
      "- Use @Reference for dependency injection",
      "- Use @Activate, @Modified, @Deactivate lifecycle methods as needed",
      "- Follow interface-impl pattern (interface defines contract, impl contains logic)",
      "- Use proper logging with LoggerFactory.getLogger()",
      "- Handle ResourceResolver lifecycle properly (close in finally blocks)"
    ].join("\n");
  } else if (artifactType === "scheduler") {
    const servicesPath = projectConfigService.getServicesPath();
    artifactInstructions = [
      `You are creating an AEM SCHEDULER. Artifact type: scheduler.`,
      `DO NOT create any component files. Only create Java files.`,
      "",
      "=== USE THESE EXACT NAMES ===",
      `Java class: ${className}`,
      `File path: ${servicesPath}/${className}.java`,
      "",
      "Required files:",
      `  - ${servicesPath}/${className}.java`,
      "",
      "AEM Scheduler Conventions:",
      `- Package: ${javaPackage}.services (schedulers are OSGi services)`,
      "- Implement Runnable interface",
      "- Use @Component(service = Runnable.class) annotation",
      "- Use @Designate(ocd = ...) with @ObjectClassDefinition for configurable schedule",
      "- Define scheduler.expression (cron) and scheduler.concurrent (false) in config annotation",
      "- Use ResourceResolverFactory with service users for repository access",
      "- Add proper logging for execution tracking",
      "- Handle exceptions gracefully — schedulers must not crash"
    ].join("\n");
  } else if (artifactType === "filter") {
    const filtersPath = projectConfigService.getFiltersPath();
    artifactInstructions = [
      `You are creating an AEM SERVLET FILTER. Artifact type: filter.`,
      `DO NOT create any component files. Only create Java files.`,
      "",
      "=== USE THESE EXACT NAMES ===",
      `Java class: ${className}`,
      `File path: ${filtersPath}/${className}.java`,
      "",
      "Required files:",
      `  - ${filtersPath}/${className}.java`,
      "",
      "AEM Filter Conventions:",
      `- Package: ${javaPackage}.filters`,
      "- Implement javax.servlet.Filter",
      "- Use @Component with service = Filter.class",
      "- Use @SlingServletFilter annotation with scope, pattern, or resourceTypes",
      "- Set service.ranking for filter ordering",
      "- Call chain.doFilter() to pass request downstream",
      "- Handle both request and response phases as needed"
    ].join("\n");
  } else {
    // workflow, listener, or anything else — let the AI figure out the specifics
    const servicesPath = projectConfigService.getServicesPath();
    artifactInstructions = [
      `You are creating an AEM ${artifactType.toUpperCase()}. Artifact type: ${artifactType}.`,
      `DO NOT create any component files (.content.xml, HTL, dialog) unless the user explicitly asks for a component.`,
      `Only create the Java files needed for this ${artifactType}.`,
      "",
      "=== USE THESE EXACT NAMES ===",
      `Java class: ${className}`,
      `File path: ${servicesPath}/${className}.java`,
      "",
      `Generate ONLY the files required for a ${artifactType}. Use standard AEM/OSGi conventions.`,
      `- Package: ${javaPackage}.services`,
      "- Use proper OSGi annotations (@Component, @Reference, @Activate)",
      "- Use ResourceResolverFactory with service users, never admin sessions"
    ].join("\n");
  }

  const system = [
    getAemPromptPreamble(
      "Generate the requested AEM code following strict conventions and best practices."
    ),
    "You are an expert AEM architect generating production-ready code for a trainee.",
    "",
    mode === "update"
      ? "You are UPDATING an existing artifact. Keep existing naming unless user explicitly requests a rename."
      : "You are CREATING a new artifact.",
    "",
    "CRITICAL: Only generate files appropriate for the artifact type.",
    "- If the request is for a SERVLET: generate ONLY servlet Java files (and optionally a service). Do NOT generate HTL, dialog, .content.xml, or test pages.",
    "- If the request is for a SERVICE: generate ONLY the service interface and implementation Java files.",
    "- If the request is for a SCHEDULER: generate ONLY the scheduler Java file.",
    "- If the request is for a FILTER: generate ONLY the filter Java file.",
    "- If the request is for a COMPONENT: generate the full component set (HTL, dialog, .content.xml, Sling Model, test page).",
    "",
    artifactInstructions,
    "",
    projectBlock,
    "",
    "RESPONSE FORMAT (CRITICAL — you MUST follow this exactly):",
    "- Your ENTIRE response must be a single JSON object. Nothing before it, nothing after it.",
    "- No markdown fences, no commentary, no trailing explanation.",
    "- If required details are missing, return: {\"needsClarification\":true,\"question\":\"...\"}",
    "- Otherwise return:",
    '  {"explanation":"Markdown explanation of what was created","files":[{"path":"relative/path/from/project/root","content":"full file content"}]}',
    "",
    "Paths must be relative to the AEM project root.",
    "Respond with ONLY the JSON object, no other text."
  ]
    .filter(Boolean)
    .join("\n");

  const user = [
    topic ? `Focus topic: ${topic}` : null,
    `User request: ${message}`,
    `Artifact type: ${artifactType}`,
    `Operation mode: ${mode}`,
    toDataBlock("user_request", message, 1200),
    repoContext ? toDataBlock("repository_context", repoContext, 4000) : null
  ]
    .filter(Boolean)
    .join("\n");

  return { system, user, artifactType, intent };
}

function fixAIResponsePaths(result, prompt, artifactType) {
  if (!result || !result.files) return result;

  // Only rewrite paths for components — servlets/services know their own names
  if (artifactType && artifactType !== "component") return result;

  const userRequest = extractUserRequest(prompt);
  if (!userRequest) return result;
  const { folderName, className } = sanitizeComponentName(userRequest);

  result.files = result.files.map((file) => {
    let p = file.path;

    if (p.endsWith(".java") && p.includes("/models/")) {
      const javaFile = p.split("/").pop();
      if (javaFile.toLowerCase().includes(folderName) && javaFile !== `${className}Model.java`) {
        p = p.replace(javaFile, `${className}Model.java`);
        file.content = file.content
          .replace(/public\s+class\s+\w+Model/g, `public class ${className}Model`)
          .replace(/class\s+\w+Model/g, `class ${className}Model`);
      }
    }

    file.path = p;
    return file;
  });

  return result;
}

function validateBuilderResponse(parsed) {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Builder response must be a JSON object");
  }

  if (parsed.needsClarification === true) {
    if (!parsed.question || typeof parsed.question !== "string") {
      throw new Error("Clarification response must include a question");
    }
    return;
  }

  if (!Array.isArray(parsed.files) || parsed.files.length === 0) {
    throw new Error("Builder response must include a non-empty files array");
  }

  parsed.files.forEach((file, index) => {
    if (!file || typeof file !== "object") {
      throw new Error(`File at index ${index} is not an object`);
    }
    if (!file.path || typeof file.path !== "string") {
      throw new Error(`File at index ${index} is missing a valid path`);
    }
    if (typeof file.content !== "string") {
      throw new Error(`File at index ${index} is missing valid content`);
    }
  });
}

async function askAIForFeatureFiles(prompt, artifactType) {
  if (appConfig.ai.mode === "claude" || appConfig.ai.mode === "openai") {
    try {
      const raw = appConfig.ai.mode === "claude"
        ? await askWithClaude(prompt)
        : await askWithOpenAI(prompt);
      const parsed = extractJSON(raw);
      if (!parsed) {
        logger.warn("AI raw response (first 500 chars)", { snippet: raw.slice(0, 500) });
        throw new Error("AI response did not contain valid JSON");
      }
      validateBuilderResponse(parsed);
      if (parsed.needsClarification) {
        return parsed;
      }

      // Only do component-specific name rewriting for components
      if (artifactType === "component") {
        let aiName = "";
        if (parsed.componentName && typeof parsed.componentName === "string") {
          aiName = parsed.componentName;
        } else if (parsed.files && parsed.files.length > 0) {
          const match = parsed.files[0].path.match(/components\/(\w+)/);
          if (match) aiName = match[1];
        }
        if (!aiName) {
          const userRequest = extractUserRequest(prompt);
          aiName = inferBuildIntent(userRequest || "sample").folderName;
        }
        const { folderName, className } = sanitizeComponentName(aiName);
        parsed.files = parsed.files.map(f => {
          let newPath = f.path.replace(/components\/[^/]+/, `components/${folderName}`);
          if (f.path.includes("/models/")) {
            newPath = newPath.replace(/models\/[^/]+/, `models/${className}Model.java`);
          }
          return { ...f, path: newPath };
        });
        return fixAIResponsePaths(parsed, prompt, artifactType);
      }

      // For non-component artifacts, trust the AI paths (we gave it exact paths)
      return parsed;
    } catch (error) {
      logger.warn("AI model failed or returned invalid JSON for builder, falling back to mock", {
        error: error.message
      });
    }
  }
  // fallback to mock
  const userRequest = extractUserRequest(prompt);
  const intent = inferBuildIntent(userRequest || "sample");
  return createMockBuilderResponse(intent.className, intent.artifactType);
}

module.exports = {
  askAI,
  buildFeaturePrompt,
  askAIForFeatureFiles,
  inferBuildIntent,
  getTrainerContext,
  getQAContext,
  toDataBlock,
  getAemPromptPreamble
};
