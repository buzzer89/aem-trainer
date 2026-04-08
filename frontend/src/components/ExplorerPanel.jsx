import { useEffect, useState } from "react";
import Spinner from "./Spinner";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

function FileTreeNode({ node, depth, highlightedFiles, onFileClick }) {
  const [expanded, setExpanded] = useState(false);
  const isHighlighted = highlightedFiles.includes(node.path);

  if (node.type === "file") {
    return (
      <div
        className={`tree-file ${isHighlighted ? "tree-file--new" : ""}`}
        style={{ paddingLeft: `${(depth + 1) * 18 + 4}px` }}
        onClick={() => onFileClick(node.path)}
        title={node.path}
      >
        <span className="tree-icon">📄</span>
        <span className="tree-name">{node.name}</span>
        {isHighlighted && <span className="tree-badge">NEW</span>}
      </div>
    );
  }

  return (
    <div className="tree-dir-group">
      <div
        className="tree-dir"
        style={{ paddingLeft: `${depth * 18 + 4}px` }}
        onClick={() => setExpanded((prev) => !prev)}
      >
        <span className="tree-toggle">{expanded ? "−" : "+"}</span>
        <span className="tree-icon">{expanded ? "📂" : "📁"}</span>
        <span className="tree-name">{node.name}</span>
      </div>
      {expanded &&
        node.children?.map((child) => (
          <FileTreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            highlightedFiles={highlightedFiles}
            onFileClick={onFileClick}
          />
        ))}
    </div>
  );
}

function ExplorerPanel({ highlightedFiles, tasks, onRevert, onExplainFile }) {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedCategory, setExpandedCategory] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileContent, setFileContent] = useState(null);
  const [explaining, setExplaining] = useState(false);
  const [explanation, setExplanation] = useState(null);

  useEffect(() => {
    fetchTree();
  }, [highlightedFiles]);

  async function fetchTree() {
    try {
      const response = await fetch(`${API_BASE_URL}/explorer/tree`);
      const data = await response.json();
      setCategories(data.categories);
    } catch (error) {
      console.error("Failed to load explorer tree", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleFileClick(filePath) {
    setSelectedFile(filePath);
    setExplanation(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/explorer/file?filePath=${encodeURIComponent(filePath)}`
      );
      const data = await response.json();
      setFileContent(data.content);
    } catch (error) {
      setFileContent("Failed to load file content.");
    }
  }

  async function handleExplain() {
    if (!selectedFile) return;
    setExplaining(true);

    try {
      const response = await fetch(`${API_BASE_URL}/explorer/explain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath: selectedFile })
      });
      const data = await response.json();
      setExplanation(data.explanation);

      if (onExplainFile) {
        onExplainFile(selectedFile, data.explanation);
      }
    } catch (error) {
      setExplanation("Failed to get explanation.");
    } finally {
      setExplaining(false);
    }
  }

  function handleClosePreview() {
    setSelectedFile(null);
    setFileContent(null);
    setExplanation(null);
  }

  if (loading) {
    return (
      <section className="panel explorer-panel">
        <div className="panel-header">
          <div>
            <p className="panel-label">Project Explorer</p>
            <h2>AEM Codebase</h2>
          </div>
        </div>
        <div className="explorer-loading">
          <Spinner label="Loading project files..." />
        </div>
      </section>
    );
  }

  return (
    <section className="panel explorer-panel">
      <div className="panel-header">
        <div>
          <p className="panel-label">Project Explorer</p>
          <h2>AEM Codebase</h2>
        </div>
        <button className="refresh-btn" onClick={fetchTree} title="Refresh">
          ↻
        </button>
      </div>

      <div className="explorer-body">
        <div className="explorer-tree">
          {categories.map((category) => (
            <div key={category.id} className="category-group">
              <div
                className="category-header"
                onClick={() =>
                  setExpandedCategory((prev) =>
                    prev === category.id ? null : category.id
                  )
                }
              >
                <span>{expandedCategory === category.id ? "▼" : "▶"}</span>
                <span className="category-label">{category.label}</span>
                <span className="category-count">
                  {countFiles(category.children)}
                </span>
              </div>
              {expandedCategory === category.id &&
                category.children.map((child) => (
                  <FileTreeNode
                    key={child.path}
                    node={child}
                    depth={0}
                    highlightedFiles={highlightedFiles}
                    onFileClick={handleFileClick}
                  />
                ))}
            </div>
          ))}
        </div>

        {selectedFile && (
          <div className="file-preview">
            <div className="preview-header">
              <span className="preview-filename" title={selectedFile}>
                {selectedFile.split("/").pop()}
              </span>
              <div className="preview-actions">
                <button
                  className="explain-btn"
                  onClick={handleExplain}
                  disabled={explaining}
                >
                  {explaining ? "Explaining..." : "Explain This File"}
                </button>
                <button className="close-btn" onClick={handleClosePreview}>
                  ✕
                </button>
              </div>
            </div>
            <div className="preview-path">{selectedFile}</div>
            <pre className="preview-code">{fileContent}</pre>
            {explanation && (
              <div className="preview-explanation">
                <div className="explanation-header">AI Explanation</div>
                <div className="explanation-body">{explanation}</div>
              </div>
            )}
          </div>
        )}
      </div>

      {tasks.length > 0 && (
        <div className="task-history">
          <div className="task-history-header">Recent Tasks</div>
          {tasks.map((task) => (
            <div
              key={task.taskId}
              className={`task-item ${task.reverted ? "task-item--reverted" : ""}`}
            >
              <div className="task-info">
                <span className="task-label">{task.label}</span>
                <span className="task-files">
                  {task.files.length} file(s)
                </span>
              </div>
              {!task.reverted ? (
                <button
                  className="revert-btn"
                  onClick={() => onRevert(task.taskId)}
                >
                  Revert
                </button>
              ) : (
                <span className="task-reverted-badge">Reverted</span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function countFiles(children) {
  let count = 0;
  for (const child of children) {
    if (child.type === "file") {
      count++;
    } else if (child.children) {
      count += countFiles(child.children);
    }
  }
  return count;
}

export default ExplorerPanel;
