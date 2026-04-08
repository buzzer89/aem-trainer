const { exec } = require("child_process");
const util = require("util");
const path = require("path");

const appConfig = require("../../config/default");
const logger = require("./logger");

const execAsync = util.promisify(exec);

function resolveCommand({ command, preset }) {
  if (preset) {
    const presetCommand = appConfig.commands.presets[preset];

    if (!presetCommand) {
      const error = new Error(`Unknown command preset: ${preset}`);
      error.statusCode = 400;
      throw error;
    }

    if (preset === "logs") {
      return `tail -n 200 "${appConfig.commands.logPath}"`;
    }

    return presetCommand;
  }

  return command;
}

function validateCommand(command) {
  const executable = command.trim().split(/\s+/)[0];

  if (!appConfig.commands.allowedExecutables.includes(executable)) {
    const error = new Error(
      `Command "${executable}" is not allowed. Allowed commands: ${appConfig.commands.allowedExecutables.join(
        ", "
      )}`
    );
    error.statusCode = 403;
    throw error;
  }
}

async function runCommand({ command, preset }) {
  const resolvedCommand = resolveCommand({ command, preset });
  validateCommand(resolvedCommand);
  const workingDirectory = path.resolve(appConfig.repo.projectDir);

  logger.info("Executing command", { resolvedCommand, workingDirectory });

  try {
    const { stdout, stderr } = await execAsync(resolvedCommand, {
      cwd: workingDirectory,
      timeout: 1000 * 60 * 10,
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        ...(process.env.JAVA_HOME ? { JAVA_HOME: process.env.JAVA_HOME } : {}),
        PATH: process.env.JAVA_HOME
          ? `${process.env.JAVA_HOME}/bin:${process.env.PATH}`
          : process.env.PATH
      }
    });

    return {
      command: resolvedCommand,
      workingDirectory,
      stdout,
      stderr,
      success: true
    };
  } catch (error) {
    return {
      command: resolvedCommand,
      workingDirectory,
      stdout: error.stdout || "",
      stderr: error.stderr || error.message,
      success: false
    };
  }
}

module.exports = {
  runCommand
};
