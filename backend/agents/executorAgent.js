const commandService = require("../services/commandService");

async function handleExecutionRequest({ command, preset }) {
  return commandService.runCommand({ command, preset });
}

module.exports = {
  handleExecutionRequest
};
