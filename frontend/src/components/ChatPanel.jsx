import { useEffect, useRef, useState } from "react";

import MessageBubble from "./MessageBubble";
import Spinner from "./Spinner";

function ChatPanel({
  title,
  topic,
  topics,
  chatMode,
  messages,
  loading,
  onTopicChange,
  onModeChange,
  onSendMessage
}) {
  const [draft, setDraft] = useState("");
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function handleSubmit(event) {
    event.preventDefault();

    if (!draft.trim() || loading) {
      return;
    }

    onSendMessage(draft.trim());
    setDraft("");
  }

  return (
    <section className="panel chat-panel">
      <div className="panel-header">
        <div>
          <p className="panel-label" style={{color: '#86BC25'}}>Deloitte Interactive Labs</p>
          <h2>{title}</h2>
        </div>
        <div className="panel-controls">
          <label>
            Agent
            <select value={chatMode} onChange={(event) => onModeChange(event.target.value)}>
              <option value="trainer">Deloitte Trainer</option>
              <option value="reviewer">Deloitte Reviewer</option>
            </select>
          </label>
          <label>
            Topic
            <select value={topic} onChange={(event) => onTopicChange(event.target.value)}>
              {topics.map((topicOption) => (
                <option key={topicOption} value={topicOption}>
                  {topicOption}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="message-list">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        {loading ? <Spinner label="Agent is preparing a response..." /> : null}
        <div ref={messagesEndRef} />
      </div>

      <form className="chat-form" onSubmit={handleSubmit}>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={5}
          placeholder={
            chatMode === "trainer"
              ? "Ask for a Deloitte AEM lesson, lab, or explanation..."
              : "Ask a repo-aware AEM review question..."
          }
        />
        <button type="submit" disabled={loading || !draft.trim()}>
          {loading ? "Thinking..." : "Send"}
        </button>
      </form>
    </section>
  );
}

export default ChatPanel;
