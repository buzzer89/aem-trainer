function renderBlocks(content) {
  const segments = content.split(/```/g);

  return segments.map((segment, index) => {
    if (index % 2 === 1) {
      return (
        <pre key={`code-${index}`} className="message-code">
          <code>{segment.replace(/^\w+\n/, "")}</code>
        </pre>
      );
    }

    return segment
      .split("\n")
      .filter((line, lineIndex, lines) => !(line === "" && lineIndex === lines.length - 1))
      .map((line, lineIndex) => (
        <p key={`line-${index}-${lineIndex}`} className="message-line">
          {line || "\u00a0"}
        </p>
      ));
  });
}

function MessageBubble({ message }) {
  return (
    <article className={`message-bubble ${message.role === "user" ? "user" : "assistant"}`}>
      <div className="message-meta">
        <span>{message.role === "user" ? "You" : message.agent === "reviewer" ? "Deloitte Reviewer" : "Deloitte Trainer"}</span>
      </div>
      <div className="message-content">{renderBlocks(message.content)}</div>
    </article>
  );
}

export default MessageBubble;
