function CommandPanel({ loading, output, onRunCommand }) {
  return (
    <section className="panel command-panel">
      <div className="panel-header">
        <div>
          <p className="panel-label">Executor Agent</p>
          <h2>Command Center</h2>
        </div>
      </div>

      <div className="command-grid">
        <button onClick={() => onRunCommand("build")} disabled={loading}>
          Build Project
        </button>
        <button onClick={() => onRunCommand("deploy")} disabled={loading}>
          Build & Deploy
        </button>
        <button onClick={() => onRunCommand("logs")} disabled={loading}>
          Check Logs
        </button>
        <button onClick={() => onRunCommand("packages")} disabled={loading}>
          List Files
        </button>
      </div>

      <div className="console-panel">
        <div className="console-header">
          <span>Console Output</span>
          {loading ? <span className="console-badge">Running...</span> : null}
        </div>
        <pre>{output}</pre>
      </div>
    </section>
  );
}

export default CommandPanel;
