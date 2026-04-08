import { useEffect, useMemo, useRef, useState } from "react";

import ChatPanel from "./components/ChatPanel";
import CommandPanel from "./components/CommandPanel";
import ExplorerPanel from "./components/ExplorerPanel";
import SetupPanel from "./components/SetupPanel";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

const TOPICS = [
  "General AEM",
  "Sling Models",
  "Servlets",
  "OSGi Services",
  "HTL",
  "Content Fragments",
  "Dispatcher",
  "Workflows",
  "JCR Queries",
  "MSM and Launches"
];

const INITIAL_MESSAGES = [
  {
    id: "assistant-welcome",
    role: "assistant",
    agent: "trainer",
    content:
      "Welcome to Deloitte AEM Labs!\n\nChoose a topic, ask for a lesson, or switch to Reviewer mode for repo-aware answers."
  }
];

function App() {
  const [messages, setMessages] = useState(INITIAL_MESSAGES);
  const [chatMode, setChatMode] = useState("trainer");
  const [topic, setTopic] = useState(TOPICS[0]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [commandOutput, setCommandOutput] = useState("Command output will appear here.");
  const [isCommandLoading, setIsCommandLoading] = useState(false);
  const [backendStatus, setBackendStatus] = useState("Checking backend...");
  const [highlightedFiles, setHighlightedFiles] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [setupDone, setSetupDone] = useState(null);
  const messageIdRef = useRef(1);

  useEffect(() => {
    async function checkSetup() {
      try {
        const response = await fetch(`${API_BASE_URL}/setup/config`);
        const data = await response.json();
        setSetupDone(data.configured);
      } catch {
        setSetupDone(false);
      }
    }

    checkSetup();
  }, []);

  useEffect(() => {
    async function fetchHealth() {
      try {
        const response = await fetch(`${API_BASE_URL}/health`);
        const data = await response.json();
        setBackendStatus(
          `Backend online • Indexed files: ${data.indexedFiles} • Project: ${data.indexedProjectDir}`
        );
      } catch (error) {
        setBackendStatus("Backend unavailable. Start the Express server to enable training and commands.");
      }
    }

    fetchHealth();
  }, []);

  const chatTitle = useMemo(() => {
    return chatMode === "trainer" ? "Deloitte Trainer" : "Deloitte Reviewer";
  }, [chatMode]);

  async function handleSendMessage(content) {
    const userMessage = {
      id: `user-${messageIdRef.current++}`,
      role: "user",
      agent: chatMode,
      content
    };

    setMessages((current) => [...current, userMessage]);
    setIsChatLoading(true);

    try {
      const endpoint = chatMode === "trainer" ? "/train" : "/ask";
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ message: content, topic })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch agent response");
      }

      const assistantMessage = {
        id: `assistant-${messageIdRef.current++}`,
        role: "assistant",
        agent: chatMode,
        content:
          chatMode === "reviewer" && data.references?.length
            ? `${data.answer}\n\n### Referenced Files\n${data.references
                .map((reference) => `- ${reference.path} (score: ${reference.score})`)
                .join("\n")}`
            : chatMode === "trainer" && data.filesCreated?.length
            ? `${data.answer}\n\n**${data.filesCreated.length} file(s) created in your AEM project.**`
            : data.answer
      };

      if (data.filesCreated?.length) {
        setHighlightedFiles((prev) => [...prev, ...data.filesCreated]);
        fetchTasks();
      }

      setMessages((current) => [...current, assistantMessage]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${messageIdRef.current++}`,
          role: "assistant",
          agent: chatMode,
          content: `Request failed: ${error.message}`
        }
      ]);
    } finally {
      setIsChatLoading(false);
    }
  }

  async function handleRunCommand(preset) {
    setIsCommandLoading(true);
    setCommandOutput(`Running ${preset}...`);

    try {
      const response = await fetch(`${API_BASE_URL}/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ preset })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Command execution failed");
      }

      setCommandOutput(
        [
          `$ ${data.command}`,
          `cwd: ${data.workingDirectory}`,
          data.stdout?.trim(),
          data.stderr?.trim()
        ]
          .filter(Boolean)
          .join("\n\n")
      );
    } catch (error) {
      setCommandOutput(`Command failed: ${error.message}`);
    } finally {
      setIsCommandLoading(false);
    }
  }

  async function fetchTasks() {
    try {
      const response = await fetch(`${API_BASE_URL}/explorer/tasks`);
      const data = await response.json();
      setTasks(data.tasks);
    } catch (error) {
      console.error("Failed to fetch tasks", error);
    }
  }

  async function handleRevert(taskId) {
    try {
      const response = await fetch(`${API_BASE_URL}/explorer/revert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Revert failed");
      }

      const revertedPaths = data.results
        .filter((r) => r.success)
        .map((r) => r.path);

      setHighlightedFiles((prev) =>
        prev.filter((f) => !revertedPaths.includes(f))
      );

      setMessages((current) => [
        ...current,
        {
          id: `assistant-${messageIdRef.current++}`,
          role: "assistant",
          agent: "trainer",
          content: `### Reverted: ${data.label}\n\nRemoved ${revertedPaths.length} file(s):\n${revertedPaths.map((p) => "- `" + p + "`").join("\n")}`
        }
      ]);

      fetchTasks();
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${messageIdRef.current++}`,
          role: "assistant",
          agent: "trainer",
          content: `Revert failed: ${error.message}`
        }
      ]);
    }
  }

  function handleExplainFile(filePath, explanation) {
    setMessages((current) => [
      ...current,
      {
        id: `user-${messageIdRef.current++}`,
        role: "user",
        agent: "trainer",
        content: `Explain this file: ${filePath}`
      },
      {
        id: `assistant-${messageIdRef.current++}`,
        role: "assistant",
        agent: "trainer",
        content: explanation
      }
    ]);
  }

  if (setupDone === null) {
    return (
      <div className="app-shell">
        <div className="setup-loading">
          <span className="spinner" />
          Loading...
        </div>
      </div>
    );
  }

  if (!setupDone) {
    return (
      <div className="app-shell">
        <SetupPanel onSetupComplete={() => setSetupDone(true)} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div style={{display: 'flex', alignItems: 'center', gap: 0}}>
          <img src="/src/assets/deloitte-logo.png" alt="Deloitte" style={{height: 75, marginRight: 0}} />
          <p className="eyebrow" style={{color: '#86BC25', margin: 0, fontWeight: 700, fontSize: '1.8rem'}}>AEM Labs</p>
        </div>
        {/* <h1 style={{margin: 0}}>AEM Labs</h1> */}
        <div className="status-pill">{backendStatus}</div>
      </header>

      <main className="workspace-grid">
        <ExplorerPanel
          highlightedFiles={highlightedFiles}
          tasks={tasks}
          onRevert={handleRevert}
          onExplainFile={handleExplainFile}
        />
        <ChatPanel
          title={chatTitle}
          topic={topic}
          topics={TOPICS}
          chatMode={chatMode}
          messages={messages}
          loading={isChatLoading}
          onTopicChange={setTopic}
          onModeChange={setChatMode}
          onSendMessage={handleSendMessage}
        />
        <CommandPanel
          loading={isCommandLoading}
          output={commandOutput}
          onRunCommand={handleRunCommand}
        />
      </main>
    </div>
  );
}

export default App;
