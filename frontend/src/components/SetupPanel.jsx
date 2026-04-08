import { useState } from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

const DEFAULT_FORM = {
  appTitle: "",
  appId: "",
  groupId: "",
  aemVersion: "6.5.8",
  archetypeVersion: "56",
  frontendModule: "general",
  includeDispatcherConfig: "n"
};

function SetupPanel({ onSetupComplete }) {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [step, setStep] = useState("form");
  const [commandPreview, setCommandPreview] = useState("");
  const [generateOutput, setGenerateOutput] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setError("");
  }

  async function handleConfigure(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/setup/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Configuration failed");
      }

      const previewRes = await fetch(`${API_BASE_URL}/setup/preview-command`);
      const previewData = await previewRes.json();
      setCommandPreview(previewData.command);
      setStep("confirm");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerate() {
    setLoading(true);
    setError("");
    setGenerateOutput("Running Maven archetype generation...\nThis may take a few minutes.\n");
    setStep("generating");

    try {
      const response = await fetch(`${API_BASE_URL}/setup/generate/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        const errMsg = data.error || "Generation failed";
        setGenerateOutput((prev) => prev + `\nError: ${errMsg}\n${data.stderr || ""}`);
        setError(errMsg);
        setStep("confirm");
        return;
      }

      setGenerateOutput(
        (prev) =>
          prev +
          `\nProject generated successfully!\nLocation: ${data.generatedDir}\n\n` +
          (data.stdout || "")
      );
      setStep("done");
    } catch (err) {
      setGenerateOutput((prev) => prev + `\nError: ${err.message}`);
      setError(err.message);
      setStep("confirm");
    } finally {
      setLoading(false);
    }
  }

  async function handleSkipGenerate() {
    onSetupComplete();
  }

  function handleFinish() {
    onSetupComplete();
  }

  return (
    <div className="setup-overlay">
      <div className="setup-card">
        <div className="setup-header">
          <p className="eyebrow">Project Setup</p>
          <h2>Configure AEM Project</h2>
          <p className="setup-subtitle">
            Set up your AEM project details. You can generate a new project from
            the Maven archetype or use an existing one.
          </p>
        </div>

        {error && <div className="setup-error">{error}</div>}

        {step === "form" && (
          <form className="setup-form" onSubmit={handleConfigure}>
            <div className="form-row">
              <label className="form-label">
                App Title *
                <input
                  className="form-input"
                  name="appTitle"
                  placeholder="My AEM Site"
                  value={form.appTitle}
                  onChange={handleChange}
                  required
                />
              </label>
              <label className="form-label">
                App ID *
                <input
                  className="form-input"
                  name="appId"
                  placeholder="mysite"
                  value={form.appId}
                  onChange={handleChange}
                  required
                  pattern="^[a-z][a-z0-9]*$"
                  title="Lowercase alphanumeric, starting with a letter"
                />
              </label>
            </div>

            <div className="form-row">
              <label className="form-label">
                Group ID *
                <input
                  className="form-input"
                  name="groupId"
                  placeholder="com.mycompany"
                  value={form.groupId}
                  onChange={handleChange}
                  required
                  pattern="^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$"
                  title="Valid Java package name (e.g., com.mycompany)"
                />
              </label>
              <label className="form-label">
                AEM Version
                <select
                  className="form-input"
                  name="aemVersion"
                  value={form.aemVersion}
                  onChange={handleChange}
                >
                  <option value="6.5.8">6.5.8</option>
                  <option value="6.5.0">6.5.0</option>
                  <option value="cloud">Cloud Service</option>
                </select>
              </label>
            </div>

            <div className="form-row">
              <label className="form-label">
                Archetype Version
                <input
                  className="form-input"
                  name="archetypeVersion"
                  value={form.archetypeVersion}
                  onChange={handleChange}
                />
              </label>
              <label className="form-label">
                Frontend Module
                <select
                  className="form-input"
                  name="frontendModule"
                  value={form.frontendModule}
                  onChange={handleChange}
                >
                  <option value="general">General</option>
                  <option value="react">React</option>
                  <option value="angular">Angular</option>
                  <option value="none">None</option>
                </select>
              </label>
            </div>

            <div className="form-row">
              <label className="form-label">
                Include Dispatcher Config
                <select
                  className="form-input"
                  name="includeDispatcherConfig"
                  value={form.includeDispatcherConfig}
                  onChange={handleChange}
                >
                  <option value="n">No</option>
                  <option value="y">Yes</option>
                </select>
              </label>
            </div>

            <div className="setup-actions">
              <button type="submit" disabled={loading}>
                {loading ? "Configuring..." : "Configure Project"}
              </button>
            </div>
          </form>
        )}

        {step === "confirm" && (
          <div className="setup-confirm">
            <h3>Maven Archetype Command</h3>
            <pre className="command-preview">{commandPreview}</pre>
            <div className="setup-actions">
              <button onClick={handleGenerate} disabled={loading}>
                Generate Project
              </button>
              <button
                className="btn-secondary"
                onClick={handleSkipGenerate}
                disabled={loading}
              >
                Skip — Use Existing Project
              </button>
              <button
                className="btn-outline"
                onClick={() => setStep("form")}
                disabled={loading}
              >
                Back
              </button>
            </div>
          </div>
        )}

        {step === "generating" && (
          <div className="setup-generating">
            <div className="spinner-row">
              <span className="spinner" />
              Generating AEM project...
            </div>
            <pre className="generate-output">{generateOutput}</pre>
          </div>
        )}

        {step === "done" && (
          <div className="setup-done">
            <pre className="generate-output">{generateOutput}</pre>
            <div className="setup-actions">
              <button onClick={handleFinish}>Open Workspace</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default SetupPanel;
