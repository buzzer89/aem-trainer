// OpenAI support (v4 SDK)
let openaiApi = null;
if (process.env.OPENAI_API_KEY) {
  const { OpenAI } = require("openai");
  openaiApi = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

async function askWithOpenAI(prompt) {
  if (!openaiApi) throw new Error("OpenAI API key not set");
  const model = process.env.OPENAI_MODEL || "gpt-4";
  const res = await openaiApi.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2
  });
  return res.choices[0].message.content.trim();
}
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const util = require("util");

const appConfig = require("../../config/default");
const topics = require("../../config/topics");
const projectConfigService = require("./projectConfigService");
const logger = require("./logger");

const execFileAsync = util.promisify(execFile);

const AGENTS_DIR = path.join(__dirname, "..", "agents");

const agentContextCache = {};

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
    prompt.slice(0, 1200),
    "```"
  ].join("\n");
}

async function askWithClaude(prompt) {
  const { stdout, stderr } = await execFileAsync(
    appConfig.ai.claudeCommand,
    ["-p", prompt],
    {
      cwd: path.resolve(appConfig.repo.projectDir),
      maxBuffer: 1024 * 1024
    }
  );

  if (stderr) {
    logger.warn("Claude CLI wrote to stderr", { stderr });
  }

  return stdout.trim();
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
  const stopWords = [
    "create", "build", "scaffold", "generate", "make", "add", "new",
    "component", "with", "below", "above", "following", "features",
    "and", "the", "a", "an", "for", "that", "has", "having", "including",
    "please", "i", "want", "need", "like", "would", "which", "who", "whose", "whom", "where", "when", "why", "how"
  ];

  // Only use the first valid noun-like word (skip stopwords and trailing 'which', 'that', etc.)
  let words = rawName
    .replace(/[^a-zA-Z\s]/g, "")
    .split(/\s+/)
    .filter((w) => w && !stopWords.includes(w.toLowerCase()));

  // If the first word is still a stopword or not a valid identifier, fallback
  let base = words[0] || "customComponent";
  if (/^(which|that|with|who|whose|whom|where|when|why|how)$/i.test(base)) {
    base = "customComponent";
  }
  // Enforce camelCase and max length
  const folderName = base.replace(/[^a-zA-Z]/g, "").toLowerCase().slice(0, 20) || "customcomponent";
  const className = base.charAt(0).toUpperCase() + base.slice(1).toLowerCase() || "CustomComponent";
  const jcrTitle = className.replace(/([A-Z])/g, ' $1').trim();

  return {
    folderName,
    className,
    jcrTitle
  };
}

function createMockBuilderResponse(componentName) {
  const { folderName: lowerName, className: titleName } = sanitizeComponentName(componentName);
  const config = projectConfigService.get();
  const basePath = `${projectConfigService.getComponentsPath()}/${lowerName}`;
  const modelPath = `${projectConfigService.getModelsPath()}/${titleName}Model.java`;
  const javaPackage = projectConfigService.getJavaPackage();
  const componentGroup = projectConfigService.getComponentGroup();

  return {
    explanation: [
      `## Component: ${componentName}`,
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
          `    jcr:title="${componentName}"`,
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

function buildComponentPrompt({ message, topic, repoContext }) {
  const config = projectConfigService.get();
  const componentsPath = projectConfigService.getComponentsPath();
  const modelsPath = projectConfigService.getModelsPath();
  const javaPackage = projectConfigService.getJavaPackage();
  const componentGroup = projectConfigService.getComponentGroup();
  const agentContext = getTrainerContext();

  const { folderName, className, jcrTitle } = sanitizeComponentName(message);

  return [
    "You are the Builder Agent for an AEM AI Trainer Platform.",
    "The user wants to create or scaffold an AEM component in their project.",
    "Follow the training pipeline and code generation rules described below.",
    "",
    "--- AGENT CONTEXT ---",
    agentContext,
    "--- END AGENT CONTEXT ---",
    "",
    "==========================================================",
    "MANDATORY: USE THESE EXACT NAMES (already derived for you)",
    "==========================================================",
    "",
    `Component folder name: ${folderName}`,
    `Java class name:       ${className}Model`,
    `jcr:title:             ${jcrTitle}`,
    "",
    "Use these exact names for all generated files:",
    `  - Component folder: ${componentsPath}/${folderName}/`,
    `  - HTL file:         ${componentsPath}/${folderName}/${folderName}.html`,
    `  - Component XML:    ${componentsPath}/${folderName}/.content.xml`,
    `  - Dialog:           ${componentsPath}/${folderName}/_cq_dialog/.content.xml`,
    `  - Sling Model:      ${modelsPath}/${className}Model.java`,
    `  - Test page:        ui.content/src/main/content/jcr_root/content/${config.appId}/us/en/trainer-test-${folderName}/.content.xml`,
    "",
    "DO NOT rename or modify these names. They are pre-validated.",
    "==========================================================",
    "",
    "Project details:",
    `- Group ID: ${config.groupId}`,
    `- App folder: ${config.appId}`,
    `- Component group: ${componentGroup}`,
    `- Java package: ${javaPackage}`,
    `- Components path: ${componentsPath}/`,
    `- Sling Models path: ${modelsPath}/`,
    "",
    "AEM Code Conventions:",
    "- Component .content.xml: jcr:primaryType='cq:Component', jcr:title='" + jcrTitle + "', componentGroup='" + componentGroup + "'",
    "- HTL: <sly data-sly-use.model='" + javaPackage + ".models." + className + "Model'/>, use data-sly-test for null checks",
    "- Dialog: sling:resourceType='cq/gui/components/authoring/dialog', field names start with './' and MUST match Sling Model @ValueMapValue field names exactly (case-sensitive)",
    "- Sling Model: package " + javaPackage + ".models; @Model(adaptables=Resource.class, defaultInjectionStrategy=DefaultInjectionStrategy.OPTIONAL), use @ValueMapValue for properties",
    "- Java class declaration: public class " + className + "Model { ... }",
    "",
    topic ? `Focus topic: ${topic}` : null,
    `User request: ${message}`,
    "",
    repoContext ? `Repository context:\n${repoContext}` : null,
    "",
    "Respond with ONLY valid JSON (no markdown fences, no extra text) in this exact format:",
    '{',
    '  "explanation": "Markdown explanation of what was created and next steps",',
    '  "files": [',
    '    { "path": "relative/path/from/project/root", "content": "file content" }',
    '  ]',
    '}',
    "",
    "Generate all necessary files: .content.xml, HTL template, _cq_dialog/.content.xml, and Sling Model .java file.",
    "If the component needs client-side logic or styles, also generate a clientlibs folder.",
    "Also generate a test page .content.xml so the trainee can see the component in AEM Author.",
    "Use the project conventions and exact names above. Paths must be relative to the AEM project root."
  ]
    .filter(Boolean)
    .join("\n");
}

function fixAIResponsePaths(result, prompt) {
  if (!result || !result.files) return result;

  const userRequestMatch = prompt.match(/User request:\s*(.+)/i);
  if (!userRequestMatch) return result;

  const { folderName, className } = sanitizeComponentName(userRequestMatch[1]);

  result.files = result.files.map((file) => {
    let p = file.path;

    // Fix Java file: ensure class name is properly PascalCased
    if (p.endsWith(".java")) {
      const javaFile = p.split("/").pop();
      if (javaFile.toLowerCase().includes(folderName) && javaFile !== `${className}Model.java`) {
        p = p.replace(javaFile, `${className}Model.java`);
        // Also fix the class declaration inside the file content
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

async function askAIForComponentFiles(prompt) {
  if (appConfig.ai.mode === "claude" || appConfig.ai.mode === "openai") {
    try {
      const raw = appConfig.ai.mode === "claude"
        ? await askWithClaude(prompt)
        : await askWithOpenAI(prompt);
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("AI response did not contain valid JSON");
      }
      const parsed = JSON.parse(jsonMatch[0]);
      // Always sanitize and validate the component name
      let aiName = "";
      if (parsed.componentName && typeof parsed.componentName === "string") {
        aiName = parsed.componentName;
      } else if (parsed.files && parsed.files.length > 0) {
        // Try to infer from file paths
        const match = parsed.files[0].path.match(/components\/(\w+)/);
        if (match) aiName = match[1];
      }
      if (!aiName) {
        const componentMatch = prompt.match(/User request:\s*(.+)/i);
        aiName = componentMatch
          ? componentMatch[1].replace(/^(create|build|scaffold|make|generate)\s+(a\s+|an\s+|the\s+)?/i, "").replace(/\s+component$/i, "").trim()
          : "sample";
      }
      const { folderName, className } = sanitizeComponentName(aiName);
      // Rewrite all file paths and class names in the response
      parsed.files = parsed.files.map(f => {
        let newPath = f.path.replace(/components\/[^/]+/, `components/${folderName}`);
        newPath = newPath.replace(/models\/[^/]+/, `models/${className}Model.java`);
        return { ...f, path: newPath };
      });
      return parsed;
    } catch (error) {
      logger.warn("AI model failed or returned invalid JSON for builder, falling back to mock", {
        error: error.message
      });
    }
  }
  // fallback: sanitize name from prompt
  const componentMatch = prompt.match(/User request:\s*(.+)/i);
  const componentName = componentMatch
    ? componentMatch[1].replace(/^(create|build|scaffold|make|generate)\s+(a\s+|an\s+|the\s+)?/i, "").replace(/\s+component$/i, "").trim()
    : "sample";
  const { folderName, className } = sanitizeComponentName(componentName);
  return createMockBuilderResponse(className);
}

module.exports = {
  askAI,
  buildComponentPrompt,
  askAIForComponentFiles,
  getTrainerContext,
  getQAContext
};
